import asyncio
import base64
import binascii
import hashlib
import time
import uuid
from urllib.parse import quote

ARTIFACT_QUERY = {"compliance": "compliance-artifact", "receipt": "archive-artifact"}
ARTIFACT_KEY = {"compliance": "artifact", "receipt": "archive"}
ARTIFACT_LABEL = {"compliance": "Invoice XML", "receipt": "Receipt of Transmission"}
ARTIFACT_ALIASES = {"archive": "receipt"}
ARTIFACT_KINDS = tuple(ARTIFACT_QUERY) + tuple(ARTIFACT_ALIASES)
INVOICE_TYPE = "TRANSACTION::INVOICE"
UNTRANSMITTED_STATES = frozenset({"REJECTED", "FAILED"})


class UpstreamError(Exception):
    def __init__(self, response):
        self.status_code = response.status_code
        self.body = _error_body(response)
        super().__init__(f"fiskaly API returned {response.status_code} for {response.request.url}")


class ArtifactMissing(Exception):
    pass


async def create_invoice(client, system_id, operation, idempotency_key=None):
    return await _open_and_transact(
        client, system_id, operation, step="transaction", idempotency_key=idempotency_key
    )


async def create_correction(
    client, system_id, corrected_record_id, operation, reason=None, idempotency_key=None
):
    correction = {"type": "CORRECTION", "record": {"id": corrected_record_id}, "data": operation}
    if reason is not None:
        correction["reason"] = reason
    created = await _open_and_transact(
        client, system_id, correction, step="correction", idempotency_key=idempotency_key
    )
    return {**created, "corrected_record_id": corrected_record_id}


async def list_records(client, record_type, system_id, limit=None, token=None):
    query = [f"type={record_type}", f"system_id={quote(system_id, safe='')}"]
    if limit is not None:
        query.append(f"limit={quote(str(limit), safe='')}")
    if token is not None:
        query.append(f"token={quote(token, safe='')}")
    response = await client.request("GET", f"/records?{'&'.join(query)}", step="list")
    if response.status_code >= 400:
        raise UpstreamError(response)
    body = response.json()
    results = body.get("results") or []
    return {
        "results": [result.get("content") or result for result in results],
        "pagination": body.get("pagination"),
    }


async def fetch_files(client, record_id):
    path = f"/files/{quote(record_id, safe='')}.zip"
    response = await client.request("GET", path, step="files")
    if response.status_code >= 400:
        raise UpstreamError(response)
    return response.content


async def wait_for_transmission(client, transaction_id, timeout=None):
    interval = client.settings.poll_interval_s
    limit = client.settings.poll_timeout_s if timeout is None else timeout
    deadline = time.monotonic() + limit
    while True:
        invoice = await _read_record(client, transaction_id)
        transmission_id = (invoice.get("used_in") or {}).get("id")
        if transmission_id:
            break
        if _untransmitted(invoice):
            return _waited(transaction_id, invoice, None, finished=True)
        if time.monotonic() >= deadline:
            return _waited(transaction_id, invoice, None, finished=False)
        await asyncio.sleep(interval)
    while True:
        transmission = await _read_record(client, transmission_id)
        if transmission.get("mode") == "FINISHED":
            return _waited(transaction_id, invoice, transmission, finished=True)
        if time.monotonic() >= deadline:
            return _waited(transaction_id, invoice, transmission, finished=False)
        await asyncio.sleep(interval)


def artifact_kind(kind):
    return ARTIFACT_ALIASES.get(kind, kind)


async def fetch_artifact(client, record_id, kind="compliance"):
    kind = artifact_kind(kind)
    query = ARTIFACT_QUERY[kind]
    path = f"/records/{quote(record_id, safe='')}?{query}"
    content = _content(await client.request("GET", path, step="artifact"))
    artifact = (content.get("compliance") or {}).get(ARTIFACT_KEY[kind])
    if not artifact or not artifact.get("data"):
        raise ArtifactMissing(
            f"record {record_id} carries no {ARTIFACT_LABEL[kind]}: "
            f"content.compliance.{ARTIFACT_KEY[kind]}.data is absent from "
            f"GET /records/{record_id}?{query} (state={content.get('state')!r}, "
            f"mode={content.get('mode')!r})"
        )
    return {
        "kind": kind,
        "label": ARTIFACT_LABEL[kind],
        "type": artifact.get("type", "application/xml"),
        "xml": _decode(artifact["data"]),
    }


async def _open_and_transact(client, system_id, operation, *, step, idempotency_key):
    intention = await _create_record(
        client,
        {"type": "INTENTION", "system": {"id": system_id}, "operation": {"type": "TRANSACTION"}},
        step="intention",
        idempotency_key=_derived_key(idempotency_key, "intention"),
    )
    transaction = await _create_record(
        client,
        {"type": "TRANSACTION", "record": {"id": intention["id"]}, "operation": operation},
        step=step,
        idempotency_key=_derived_key(idempotency_key, step),
    )
    return {
        "intention_id": intention["id"],
        "transaction_id": transaction["id"],
        "state": transaction.get("state"),
        "mode": transaction.get("mode"),
        "logs": transaction.get("logs") or [],
    }


def _derived_key(idempotency_key, label):
    if idempotency_key is None:
        return None
    digest = hashlib.sha256(f"{idempotency_key}:{label}".encode()).digest()
    return str(uuid.UUID(bytes=digest[:16], version=4))


async def _create_record(client, content, *, step, idempotency_key):
    response = await client.request(
        "POST", "/records", json={"content": content}, step=step, idempotency_key=idempotency_key
    )
    return _content(response)


async def _read_record(client, record_id):
    path = f"/records/{quote(record_id, safe='')}"
    return _content(await client.request("GET", path, step="poll"))


def _content(response):
    if response.status_code >= 400:
        raise UpstreamError(response)
    body = response.json()
    content = body.get("content") if isinstance(body, dict) else None
    if not isinstance(content, dict):
        raise ValueError(f"{response.request.url} returned no record content: {body!r}")
    return content


def _untransmitted(invoice):
    if invoice.get("state") in UNTRANSMITTED_STATES:
        return True
    return any(log.get("severity") == "ERROR" for log in invoice.get("logs") or [])


def _waited(transaction_id, invoice, transmission, *, finished):
    return {
        "transaction_id": transaction_id,
        "transmission_id": transmission and transmission.get("id"),
        "finished": finished,
        "state": invoice.get("state"),
        "mode": invoice.get("mode"),
        "logs": invoice.get("logs") or [],
        "transmission": transmission
        and {
            "id": transmission.get("id"),
            "state": transmission.get("state"),
            "mode": transmission.get("mode"),
            "logs": transmission.get("logs") or [],
        },
    }


def _decode(data):
    try:
        return base64.b64decode(data, validate=True).decode("utf-8")
    except (binascii.Error, ValueError) as exc:
        raise ArtifactMissing(f"artifact data is not base64-encoded UTF-8: {exc}") from exc


def _error_body(response):
    try:
        body = response.json()
    except ValueError:
        return {"message": response.text}
    if isinstance(body, dict):
        content = body.get("content")
        return content if isinstance(content, dict) else body
    return body if isinstance(body, list) else {"message": body}
