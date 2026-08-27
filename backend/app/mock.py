import base64
import binascii
import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from lxml import etree

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "uapi"
RECEPTION_TYPE = "E_INVOICE::RECEPTION"
TRANSMISSION_TYPE = "E_INVOICE::TRANSMISSION"
INVOICE_TYPE = "TRANSACTION::INVOICE"
CORRECTION_TYPE = "TRANSACTION::CORRECTION"
INTENTION_TYPE = "INTENTION::TRANSACTION"
TRANSACTED_TYPES = (INVOICE_TYPE, CORRECTION_TYPE)
ARTIFACT_FILES = {
    "fatturapa": ("fatturapa-invoice.xml", "fatturapa"),
    "ubl": ("ubl-invoice.xml", "ubl"),
}
RECEIPT_FILES = {"fatturapa": ("sdi-receipt.xml", "receipt")}
ZIP_MEMBERS = {"invoice.xml": ARTIFACT_FILES, "receipt-of-transmission.xml": RECEIPT_FILES}
PATCH_PATHS = {
    "fatturapa": {
        "number": ("FatturaElettronicaBody", "DatiGenerali", "DatiGeneraliDocumento", "Numero"),
        "total": (
            "FatturaElettronicaBody",
            "DatiGenerali",
            "DatiGeneraliDocumento",
            "ImportoTotaleDocumento",
        ),
    },
    "ubl": {"number": ("ID",), "total": ("LegalMonetaryTotal", "PayableAmount")},
    "receipt": {"file_name": ("NomeFile",), "destination_code": ("Destinatario", "Codice")},
}
EPOCH = datetime(2026, 8, 26, 9, 0, tzinfo=UTC)
FAIL_PREFIX = "FAIL-"
SDI_REJECTION = "00471 Cessionario uguale al cedente"
NO_INVOICING = "no recipient with invoicing configuration found"
USED_IN_READS = 2
FINISHED_READS = 3
DEFAULT_LIMIT = 10
MAX_LIMIT = 100


class MockTransport(httpx.MockTransport):
    def __init__(self, fixtures_dir=FIXTURES_DIR):
        super().__init__(self.handle)
        self.fixtures_dir = Path(fixtures_dir)
        self.records = {}
        self.plans = {}
        self.reads = {}
        self.receptions = []
        self.replays = {}
        self.ids = 0
        self.requests = 0
        self._xml_cache = {}

    def handle(self, request):
        self.requests += 1
        headers = {"X-Trace-Identifier": f"00000000-0000-4000-9000-{self.requests:012d}"}
        if "X-Api-Version" in request.headers:
            headers["X-Api-Version"] = request.headers["X-Api-Version"]
        segments = request.url.path.strip("/").split("/")
        if segments[0] == "records":
            response = self._records(request, segments, headers)
            if response is not None:
                return response
        if segments[0] == "files" and len(segments) == 2 and segments[1].endswith(".zip"):
            return self._zip(segments[1].removesuffix(".zip"), headers)
        fixture = self._find(request.method, segments)
        if fixture is None:
            expected = f"{request.method}_{'_'.join(segments)}.json"
            message = f"no fixture for {request.method} {request.url.path} (expected {expected})"
            return _error(404, "E_NOT_FOUND", "Not Found", message, headers)
        body = json.loads(fixture.read_text())
        meta = body.pop("_fixture", {})
        if request.method == "POST":
            for target in (body, body.get("content")):
                if isinstance(target, dict) and "id" in target:
                    target["id"] = self.next_id()
        return httpx.Response(meta.get("status", 200), json=body, headers=headers)

    def next_id(self):
        self.ids += 1
        return f"00000000-0000-4000-8000-{self.ids:012d}"

    def _records(self, request, segments, headers):
        if request.method == "POST" and len(segments) == 1:
            return self._create(request, headers)
        if request.method == "GET" and len(segments) == 1:
            return self._list(request, headers)
        if request.method == "GET" and len(segments) == 2:
            return self._retrieve(request, segments[1], headers)
        return None

    def _create(self, request, headers):
        content = _content(request)
        if content.get("type") not in ("INTENTION", "TRANSACTION"):
            return None
        key = request.headers.get("X-Idempotency-Key")
        if key in self.replays:
            return httpx.Response(
                200, json=self.replays[key], headers={**headers, "X-Idempotency-Replayed": "true"}
            )
        if content["type"] == "INTENTION":
            system_id = (content.get("system") or {}).get("id")
            if not system_id:
                message = "content.system.id is required for an INTENTION record"
                return _error(400, "E_BAD_REQUEST", "Bad Request", message, headers)
            record = self._intention(system_id)
        else:
            intention_id = (content.get("record") or {}).get("id")
            if intention_id not in self.records:
                message = f"intention record {intention_id!r} does not exist"
                return _error(404, "E_NOT_FOUND", "Not Found", message, headers)
            operation = content.get("operation") or {}
            corrected_id = (operation.get("record") or {}).get("id")
            if operation.get("type") == "CORRECTION" and corrected_id not in self.records:
                message = f"corrected record {corrected_id!r} does not exist"
                return _error(404, "E_NOT_FOUND", "Not Found", message, headers)
            record = self._transaction(intention_id, operation)
        body = {"content": record}
        if key:
            self.replays[key] = body
        return httpx.Response(
            200, json=body, headers={**headers, "X-Idempotency-Replayed": "false"}
        )

    def _list(self, request, headers):
        params = request.url.params
        types = [value for value in (params.get("type") or "").split(",") if value]
        system_id = params.get("system_id")
        if RECEPTION_TYPE in types:
            results = self._inbox(system_id)
        else:
            results = [
                record
                for record in reversed(self.records.values())
                if (not types or record["type"] in types)
                and (system_id is None or record["system"]["id"] == system_id)
            ]
        limit = _limit(params.get("limit"))
        if limit is None:
            message = f"limit must be an integer between 1 and {MAX_LIMIT}"
            return _error(400, "E_BAD_REQUEST", "Bad Request", message, headers)
        offset = _offset(params.get("token"))
        body = {"results": [{"content": record} for record in results[offset : offset + limit]]}
        if offset + limit < len(results):
            token = base64.b64encode(str(offset + limit).encode()).decode()
            path = str(request.url.copy_set_param("token", token))
            body["pagination"] = {"next": path, "token": token, "limit": limit}
        return httpx.Response(200, json=body, headers=headers)

    def _retrieve(self, request, record_id, headers):
        record = self.records.get(record_id)
        if record is None:
            return None
        self._advance(record_id)
        plan = self.plans.get(record_id, {})
        params = request.url.params
        content = dict(record)
        compliance = {}
        if "compliance-artifact" in params:
            compliance["artifact"] = self._artifact(plan, ARTIFACT_FILES)
        if "archive-artifact" in params:
            compliance["archive"] = self._artifact(plan, RECEIPT_FILES)
        compliance = {key: value for key, value in compliance.items() if value}
        if compliance:
            content["compliance"] = {"data": f"fiskaly-{record_id}", **compliance}
        if "operation" in params and plan.get("operation"):
            content["operation"] = json.dumps(plan["operation"], separators=(",", ":"))
        return httpx.Response(200, json={"content": content}, headers=headers)

    def _intention(self, system_id):
        record_id = self.next_id()
        record = self._record(record_id, INTENTION_TYPE, system_id, "ACCEPTED", "PROCESSING")
        self.records[record_id] = record
        self.plans[record_id] = {"system_id": system_id}
        return record

    def _transaction(self, intention_id, operation):
        system_id = self.plans[intention_id]["system_id"]
        record_id = self.next_id()
        correction = operation.get("type") == "CORRECTION"
        invoice = (operation.get("data") or {}) if correction else operation
        record_type = CORRECTION_TYPE if correction else INVOICE_TYPE
        record = self._record(record_id, record_type, system_id, "ACCEPTED", "PROCESSING")
        record["record"] = {"id": intention_id}
        self.records[record_id] = record
        number = str((invoice.get("document") or {}).get("number") or "")
        self.plans[record_id] = {
            "system_id": system_id,
            "operation": operation,
            "invoice": invoice,
            "format": _format(invoice, system_id),
            "fails": number.startswith(FAIL_PREFIX),
            "invoiced": _invoiced(invoice),
        }
        intention = self.records[intention_id]
        intention["used_in"] = {"id": record_id}
        intention["state"], intention["mode"] = "COMPLETED", "FINISHED"
        return record

    def _transmission(self, invoice_id):
        plan = self.plans[invoice_id]
        record_id = self.next_id()
        record = self._record(
            record_id, TRANSMISSION_TYPE, plan["system_id"], "ACCEPTED", "PROCESSING"
        )
        record["record"] = {"id": invoice_id}
        self.records[record_id] = record
        self.plans[record_id] = dict(plan)
        return record_id

    def _reception(self, transmission_id):
        plan = self.plans[transmission_id]
        record_id = self.next_id()
        record = self._record(record_id, RECEPTION_TYPE, plan["system_id"], "COMPLETED", "FINISHED")
        self.records[record_id] = record
        self.plans[record_id] = {
            **plan,
            "operation": plan.get("invoice") or plan.get("operation"),
            "sender_system": plan["system_id"],
        }
        self.receptions.append(record_id)

    def _advance(self, record_id):
        reads = self.reads[record_id] = self.reads.get(record_id, 0) + 1
        record = self.records[record_id]
        plan = self.plans.get(record_id, {})
        if record["type"] in TRANSACTED_TYPES:
            if not plan.get("invoiced"):
                record["state"], record["mode"] = "COMPLETED", "FINISHED"
                record["logs"] = [{"severity": "ERROR", "message": NO_INVOICING}]
            elif reads >= USED_IN_READS and "used_in" not in record:
                record["used_in"] = {"id": self._transmission(record_id)}
                record["state"], record["mode"] = "COMPLETED", "FINISHED"
        elif record["type"] == TRANSMISSION_TYPE and record["mode"] != "FINISHED":
            if reads >= FINISHED_READS:
                record["mode"] = "FINISHED"
                if plan.get("fails"):
                    record["state"] = "FAILED"
                    record["logs"] = [{"severity": "ERROR", "message": SDI_REJECTION}]
                else:
                    record["state"] = "COMPLETED"
                    self._reception(record_id)

    def _inbox(self, system_id):
        results = []
        for record_id in reversed(self.receptions):
            if system_id and self.plans[record_id]["sender_system"] == system_id:
                continue
            record = self.records[record_id]
            if system_id:
                record["system"] = {"id": system_id}
            results.append(record)
        return results

    def _record(self, record_id, record_type, system_id, state, mode):
        return {
            "id": record_id,
            "type": record_type,
            "state": state,
            "mode": mode,
            "system": {"id": system_id},
            "journal": {
                "signature": hashlib.sha256(record_id.encode()).hexdigest(),
                "signed_at": _timestamp(self.ids),
            },
            "file": {"location": f"records/{record_id}.json"},
        }

    def _artifact(self, plan, files):
        xml = self._artifact_xml(plan, files)
        if xml is None:
            return None
        return {"type": "application/xml", "data": base64.b64encode(xml.encode()).decode()}

    def _artifact_xml(self, plan, files):
        entry = files.get(plan.get("format"))
        xml = self._xml(entry[0]) if entry else None
        if xml is None:
            return None
        return _personalise(xml, entry[1], plan.get("invoice") or {})

    def _zip(self, record_id, headers):
        record = self.records.get(record_id)
        if record is None:
            message = f"record {record_id!r} does not exist"
            return _error(404, "E_NOT_FOUND", "Not Found", message, headers)
        plan = self.plans.get(record_id, {})
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("record.json", json.dumps({"content": record}, indent=2))
            for name, files in ZIP_MEMBERS.items():
                xml = self._artifact_xml(plan, files)
                if xml is not None:
                    archive.writestr(name, xml)
        return httpx.Response(
            200,
            content=buffer.getvalue(),
            headers={
                **headers,
                "Content-Type": "application/zip",
                "Content-Disposition": f'attachment; filename="{record_id}.zip"',
            },
        )

    def _xml(self, name):
        if name not in self._xml_cache:
            path = self.fixtures_dir / "artifacts" / name
            self._xml_cache[name] = path.read_text() if path.exists() else None
        return self._xml_cache[name]

    def _find(self, method, segments):
        files = sorted(self.fixtures_dir.glob(f"{method}_*.json"), key=lambda f: f.stem.count("{"))
        for file in files:
            pattern = file.stem.removeprefix(f"{method}_").split("_")
            if len(pattern) == len(segments) and all(
                p.startswith("{") or p == s for p, s in zip(pattern, segments, strict=True)
            ):
                return file
        return None


def _content(request):
    try:
        body = json.loads(request.content or b"{}")
    except ValueError:
        return {}
    content = body.get("content") if isinstance(body, dict) else None
    return content if isinstance(content, dict) else {}


def _format(operation, system_id):
    for recipient in operation.get("recipients") or []:
        invoicing = (recipient.get("invoicing") or {}).get("type")
        if invoicing == "SDI":
            return "fatturapa"
        if invoicing == "PEPPOL":
            return "ubl"
    return "fatturapa" if "it" in (system_id or "").lower() else "ubl"


def _invoiced(operation):
    recipients = operation.get("recipients") or []
    return any((recipient.get("invoicing") or {}).get("type") for recipient in recipients)


def _destination_code(invoice):
    for recipient in invoice.get("recipients") or []:
        invoicing = recipient.get("invoicing") or {}
        if invoicing.get("type") == "SDI":
            return invoicing.get("destination_code")
    return None


def _values(invoice):
    number = (invoice.get("document") or {}).get("number")
    return {
        "number": number,
        "total": ((invoice.get("totals") or {}).get("vat") or {}).get("inclusive"),
        "file_name": f"{number}.xml" if number else None,
        "destination_code": _destination_code(invoice),
    }


def _personalise(xml, layout, invoice):
    values = _values(invoice)
    patches = [(path, values[key]) for key, path in PATCH_PATHS[layout].items() if values[key]]
    if not patches:
        return xml
    root = etree.fromstring(xml.encode(), etree.XMLParser(no_network=True, resolve_entities=False))
    for path, value in patches:
        steps = "/".join(f"*[local-name()='{name}']" for name in path)
        for element in root.xpath(f"./{steps}")[:1]:
            element.text = str(value)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8").decode()


def _limit(value):
    if value is None:
        return DEFAULT_LIMIT
    try:
        limit = int(value)
    except ValueError:
        return None
    return limit if 1 <= limit <= MAX_LIMIT else None


def _offset(token):
    if not token:
        return 0
    try:
        return int(base64.b64decode(token, validate=True))
    except (binascii.Error, ValueError):
        return 0


def _timestamp(offset):
    moment = EPOCH + timedelta(seconds=offset)
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def _error(status, code, error, message, headers):
    body = {"content": {"status": status, "code": code, "error": error, "message": message}}
    return httpx.Response(status, json=body, headers=headers)
