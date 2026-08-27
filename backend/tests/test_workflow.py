import base64
import io
import json
import uuid
import zipfile

import httpx
import pytest
import respx

from app.recorder import Recorder
from app.session import SessionStore
from app.uapi import UapiClient
from app.workflow import (
    ArtifactMissing,
    UpstreamError,
    create_correction,
    create_invoice,
    fetch_artifact,
    fetch_files,
    list_records,
    wait_for_transmission,
)
from tests.conftest import (
    PEPPOL_INVOICING,
    SELLER_SECRET,
    api_for,
    invoice_operation,
    make_settings,
)
from tests.test_uapi import BASE_URL, token_json

INTENTION_ID = "10000000-0000-4000-8000-000000000001"
TRANSACTION_ID = "20000000-0000-4000-8000-000000000002"
TRANSMISSION_ID = "30000000-0000-4000-8000-000000000003"
CORRECTION_INTENTION_ID = "40000000-0000-4000-8000-000000000004"
CORRECTION_ID = "50000000-0000-4000-8000-000000000005"
FATTURAPA = '<?xml version="1.0"?><p:FatturaElettronica versione="FPR12" xmlns:p="urn:x"/>'
RICEVUTA = '<?xml version="1.0"?><ns3:RicevutaConsegna xmlns:ns3="urn:sdi" versione="1.0"/>'


def _content_of(xml):
    return {"type": "application/xml", "data": base64.b64encode(xml.encode()).decode()}


def record(record_id, record_type, state, mode, **extra):
    return {
        "content": {
            "id": record_id,
            "type": record_type,
            "state": state,
            "mode": mode,
            "system": {"id": "seller-system-it"},
            "journal": {"signature": "0" * 64, "signed_at": "2026-08-26T09:00:00Z"},
            "file": {"location": f"records/{record_id}.json"},
            **extra,
        }
    }


@pytest.fixture
def recorder():
    return Recorder(50)


@pytest.fixture
def client(recorder):
    store = SessionStore(make_settings(poll_interval_s=0.0, poll_timeout_s=5.0))
    return UapiClient("seller", store, recorder)


@pytest.fixture
def upstream():
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        router.post("/tokens", name="tokens").mock(
            return_value=httpx.Response(200, json=token_json())
        )
        yield router


def creation(upstream):
    return upstream.post("/records", name="create").mock(
        side_effect=[
            httpx.Response(
                200, json=record(INTENTION_ID, "INTENTION::TRANSACTION", "ACCEPTED", "PROCESSING")
            ),
            httpx.Response(
                200, json=record(TRANSACTION_ID, "TRANSACTION::INVOICE", "ACCEPTED", "PROCESSING")
            ),
        ]
    )


async def test_create_invoice_posts_intention_then_transaction(client, upstream, recorder):
    route = creation(upstream)
    operation = invoice_operation()
    result = await create_invoice(client, "seller-system-it", operation)

    assert result == {
        "intention_id": INTENTION_ID,
        "transaction_id": TRANSACTION_ID,
        "state": "ACCEPTED",
        "mode": "PROCESSING",
        "logs": [],
    }
    intention, transaction = (json.loads(call.request.content) for call in route.calls)
    assert intention == {
        "content": {
            "type": "INTENTION",
            "system": {"id": "seller-system-it"},
            "operation": {"type": "TRANSACTION"},
        }
    }
    assert transaction == {
        "content": {
            "type": "TRANSACTION",
            "record": {"id": INTENTION_ID},
            "operation": operation,
        }
    }
    assert [record.step for record in recorder.list()] == ["token", "intention", "transaction"]


async def test_create_invoice_derives_two_stable_idempotency_keys(client, upstream):
    route = creation(upstream)
    await create_invoice(client, "seller-system-it", invoice_operation(), "demo-key-1")
    first = [call.request.headers["X-Idempotency-Key"] for call in route.calls]
    assert len({uuid.UUID(key).version for key in first}) == 1
    assert {uuid.UUID(key).version for key in first} == {4}
    assert first[0] != first[1]

    route.mock(
        side_effect=[
            httpx.Response(
                200, json=record(INTENTION_ID, "INTENTION::TRANSACTION", "ACCEPTED", "PROCESSING")
            ),
            httpx.Response(
                200, json=record(TRANSACTION_ID, "TRANSACTION::INVOICE", "ACCEPTED", "PROCESSING")
            ),
        ]
    )
    await create_invoice(client, "seller-system-it", invoice_operation(), "demo-key-1")
    assert [call.request.headers["X-Idempotency-Key"] for call in route.calls][2:] == first


async def test_create_invoice_passes_upstream_error_through(client, upstream):
    upstream.post("/records").mock(
        return_value=httpx.Response(
            422,
            json={
                "status": 422,
                "code": "E_UNPROCESSABLE_CONTENT",
                "error": "Unprocessable Content",
                "message": "content.system.id does not exist",
            },
        )
    )
    with pytest.raises(UpstreamError) as raised:
        await create_invoice(client, "missing-system", invoice_operation())
    assert raised.value.status_code == 422
    assert raised.value.body["code"] == "E_UNPROCESSABLE_CONTENT"


async def test_wait_polls_transaction_then_transmission(client, upstream, recorder):
    upstream.get(f"/records/{TRANSACTION_ID}").mock(
        side_effect=[
            httpx.Response(
                200, json=record(TRANSACTION_ID, "TRANSACTION::INVOICE", "ACCEPTED", "PROCESSING")
            ),
            httpx.Response(
                200,
                json=record(
                    TRANSACTION_ID,
                    "TRANSACTION::INVOICE",
                    "COMPLETED",
                    "FINISHED",
                    used_in={"id": TRANSMISSION_ID},
                ),
            ),
        ]
    )
    upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        side_effect=[
            httpx.Response(
                200,
                json=record(TRANSMISSION_ID, "E_INVOICE::TRANSMISSION", "ACCEPTED", "PROCESSING"),
            ),
            httpx.Response(
                200,
                json=record(TRANSMISSION_ID, "E_INVOICE::TRANSMISSION", "COMPLETED", "FINISHED"),
            ),
        ]
    )
    result = await wait_for_transmission(client, TRANSACTION_ID, timeout=5.0)

    assert result["finished"] is True
    assert result["transmission_id"] == TRANSMISSION_ID
    assert result["state"] == "COMPLETED"
    assert result["transmission"]["mode"] == "FINISHED"
    assert [record.step for record in recorder.list()[1:]] == ["poll"] * 4


async def test_wait_stops_on_recipient_without_invoicing(client, upstream):
    logs = [{"severity": "ERROR", "message": "no recipient with invoicing configuration found"}]
    route = upstream.get(f"/records/{TRANSACTION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(TRANSACTION_ID, "TRANSACTION::INVOICE", "COMPLETED", "FINISHED", logs=logs),
        )
    )
    result = await wait_for_transmission(client, TRANSACTION_ID, timeout=5.0)

    assert result == {
        "transaction_id": TRANSACTION_ID,
        "transmission_id": None,
        "finished": True,
        "state": "COMPLETED",
        "mode": "FINISHED",
        "logs": logs,
        "transmission": None,
    }
    assert route.call_count == 1


async def test_wait_surfaces_failed_transmission_with_sdi_log(client, upstream):
    upstream.get(f"/records/{TRANSACTION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(
                TRANSACTION_ID,
                "TRANSACTION::INVOICE",
                "COMPLETED",
                "FINISHED",
                used_in={"id": TRANSMISSION_ID},
            ),
        )
    )
    logs = [{"severity": "ERROR", "message": "00471 Cessionario uguale al cedente"}]
    upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(
                TRANSMISSION_ID, "E_INVOICE::TRANSMISSION", "FAILED", "FINISHED", logs=logs
            ),
        )
    )
    result = await wait_for_transmission(client, TRANSACTION_ID, timeout=5.0)
    assert result["finished"] is True
    assert result["transmission"]["state"] == "FAILED"
    assert result["transmission"]["logs"] == logs


async def test_wait_timeout_keeps_record_ids(client, upstream):
    route = upstream.get(f"/records/{TRANSACTION_ID}").mock(
        return_value=httpx.Response(
            200, json=record(TRANSACTION_ID, "TRANSACTION::INVOICE", "ACCEPTED", "PROCESSING")
        )
    )
    result = await wait_for_transmission(client, TRANSACTION_ID, timeout=0.0)
    assert result["finished"] is False
    assert result["transaction_id"] == TRANSACTION_ID
    assert result["transmission_id"] is None
    assert result["mode"] == "PROCESSING"
    assert route.call_count == 1


async def test_wait_timeout_while_transmission_is_processing(client, upstream):
    upstream.get(f"/records/{TRANSACTION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(
                TRANSACTION_ID,
                "TRANSACTION::INVOICE",
                "COMPLETED",
                "FINISHED",
                used_in={"id": TRANSMISSION_ID},
            ),
        )
    )
    upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        return_value=httpx.Response(
            200, json=record(TRANSMISSION_ID, "E_INVOICE::TRANSMISSION", "ACCEPTED", "PROCESSING")
        )
    )
    result = await wait_for_transmission(client, TRANSACTION_ID, timeout=0.0)
    assert result["finished"] is False
    assert result["transmission_id"] == TRANSMISSION_ID
    assert result["transmission"]["mode"] == "PROCESSING"


async def test_fetch_artifact_decodes_base64(client, upstream, recorder):
    artifact = {
        "type": "application/xml",
        "data": base64.b64encode(FATTURAPA.encode()).decode(),
    }
    route = upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(
                TRANSMISSION_ID,
                "E_INVOICE::TRANSMISSION",
                "COMPLETED",
                "FINISHED",
                compliance={"data": "fiskaly", "artifact": artifact},
            ),
        )
    )
    result = await fetch_artifact(client, TRANSMISSION_ID)
    assert result == {
        "kind": "compliance",
        "label": "Invoice XML",
        "type": "application/xml",
        "xml": FATTURAPA,
    }
    assert route.calls.last.request.url.query == b"compliance-artifact"
    assert recorder.list()[-1].step == "artifact"


async def test_receipt_of_transmission_is_a_separate_artifact_from_the_invoice(client, upstream):
    route = upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(
                TRANSMISSION_ID,
                "E_INVOICE::TRANSMISSION",
                "COMPLETED",
                "FINISHED",
                compliance={
                    "data": "fiskaly",
                    "artifact": _content_of(FATTURAPA),
                    "archive": _content_of(RICEVUTA),
                },
            ),
        )
    )
    invoice = await fetch_artifact(client, TRANSMISSION_ID, "compliance")
    receipt = await fetch_artifact(client, TRANSMISSION_ID, "receipt")

    assert invoice["xml"] == FATTURAPA
    assert receipt["xml"] == RICEVUTA
    assert receipt["label"] == "Receipt of Transmission"
    assert invoice["xml"] != receipt["xml"]
    queries = [call.request.url.query for call in route.calls]
    assert queries == [b"compliance-artifact", b"archive-artifact"]


async def test_archive_kind_is_an_alias_for_receipt(client, upstream):
    route = upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(
                TRANSMISSION_ID,
                "E_INVOICE::TRANSMISSION",
                "COMPLETED",
                "FINISHED",
                compliance={"data": "fiskaly", "archive": _content_of(RICEVUTA)},
            ),
        )
    )
    result = await fetch_artifact(client, TRANSMISSION_ID, "archive")
    assert result["kind"] == "receipt"
    assert result["xml"] == RICEVUTA
    assert route.calls.last.request.url.query == b"archive-artifact"


async def test_missing_receipt_names_the_receipt_of_transmission(client, upstream):
    upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(TRANSMISSION_ID, "E_INVOICE::TRANSMISSION", "COMPLETED", "FINISHED"),
        )
    )
    with pytest.raises(ArtifactMissing) as raised:
        await fetch_artifact(client, TRANSMISSION_ID, "receipt")
    assert "Receipt of Transmission" in str(raised.value)
    assert "content.compliance.archive.data" in str(raised.value)


async def test_fetch_artifact_fails_loudly_when_absent(client, upstream):
    upstream.get(f"/records/{TRANSMISSION_ID}").mock(
        return_value=httpx.Response(
            200,
            json=record(TRANSMISSION_ID, "E_INVOICE::TRANSMISSION", "ACCEPTED", "PROCESSING"),
        )
    )
    with pytest.raises(ArtifactMissing) as raised:
        await fetch_artifact(client, TRANSMISSION_ID)
    message = str(raised.value)
    assert "content.compliance.artifact.data" in message
    assert TRANSMISSION_ID in message


def correction_creation(upstream):
    return upstream.post("/records", name="correct").mock(
        side_effect=[
            httpx.Response(
                200,
                json=record(
                    CORRECTION_INTENTION_ID, "INTENTION::TRANSACTION", "ACCEPTED", "PROCESSING"
                ),
            ),
            httpx.Response(
                200,
                json=record(CORRECTION_ID, "TRANSACTION::CORRECTION", "ACCEPTED", "PROCESSING"),
            ),
        ]
    )


async def test_correction_opens_its_own_intention_and_references_the_original(
    client, upstream, recorder
):
    route = correction_creation(upstream)
    operation = invoice_operation(number="2026-001-NC")
    result = await create_correction(
        client, "seller-system-it", TRANSACTION_ID, operation, "wrong quantity invoiced"
    )

    assert result == {
        "intention_id": CORRECTION_INTENTION_ID,
        "transaction_id": CORRECTION_ID,
        "corrected_record_id": TRANSACTION_ID,
        "state": "ACCEPTED",
        "mode": "PROCESSING",
        "logs": [],
    }
    intention, correction = (json.loads(call.request.content) for call in route.calls)
    assert intention == {
        "content": {
            "type": "INTENTION",
            "system": {"id": "seller-system-it"},
            "operation": {"type": "TRANSACTION"},
        }
    }
    assert correction == {
        "content": {
            "type": "TRANSACTION",
            "record": {"id": CORRECTION_INTENTION_ID},
            "operation": {
                "type": "CORRECTION",
                "record": {"id": TRANSACTION_ID},
                "data": operation,
                "reason": "wrong quantity invoiced",
            },
        }
    }
    assert [call.step for call in recorder.list()] == ["token", "intention", "correction"]


async def test_correction_omits_the_reason_when_none_is_given(client, upstream):
    route = correction_creation(upstream)
    await create_correction(client, "seller-system-it", TRANSACTION_ID, invoice_operation())
    operation = json.loads(route.calls[1].request.content)["content"]["operation"]
    assert "reason" not in operation
    assert operation["record"] == {"id": TRANSACTION_ID}


async def test_correction_derives_a_key_that_differs_from_the_invoice_transaction(client, upstream):
    route = creation(upstream)
    await create_invoice(client, "seller-system-it", invoice_operation(), "demo-key-1")
    invoice_keys = [call.request.headers["X-Idempotency-Key"] for call in route.calls]

    correction_route = correction_creation(upstream)
    await create_correction(
        client, "seller-system-it", TRANSACTION_ID, invoice_operation(), None, "demo-key-1"
    )
    correction_keys = [
        call.request.headers["X-Idempotency-Key"] for call in correction_route.calls[-2:]
    ]
    assert correction_keys[0] == invoice_keys[0]
    assert correction_keys[1] != invoice_keys[1]


async def test_correction_passes_a_missing_original_record_through(client, upstream):
    upstream.post("/records").mock(
        side_effect=[
            httpx.Response(
                200,
                json=record(
                    CORRECTION_INTENTION_ID, "INTENTION::TRANSACTION", "ACCEPTED", "PROCESSING"
                ),
            ),
            httpx.Response(
                404,
                json={
                    "content": {
                        "status": 404,
                        "code": "E_NOT_FOUND",
                        "error": "Not Found",
                        "message": "corrected record 'does-not-exist' does not exist",
                    }
                },
            ),
        ]
    )
    with pytest.raises(UpstreamError) as raised:
        await create_correction(
            client, "seller-system-it", "does-not-exist", invoice_operation(), "typo"
        )
    assert raised.value.status_code == 404
    assert raised.value.body["code"] == "E_NOT_FOUND"


async def test_list_records_unwraps_content_and_keeps_pagination(client, upstream, recorder):
    route = upstream.get("/records").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    record(TRANSACTION_ID, "TRANSACTION::INVOICE", "COMPLETED", "FINISHED"),
                    record(CORRECTION_ID, "TRANSACTION::CORRECTION", "COMPLETED", "FINISHED"),
                ],
                "pagination": {"next": "/records?token=Mg==", "token": "Mg==", "limit": 2},
            },
        )
    )
    result = await list_records(client, "TRANSACTION::INVOICE", "seller-system-it", 2, "MA==")

    assert [item["id"] for item in result["results"]] == [TRANSACTION_ID, CORRECTION_ID]
    assert result["pagination"] == {"next": "/records?token=Mg==", "token": "Mg==", "limit": 2}
    query = route.calls.last.request.url.query.decode()
    assert query == "type=TRANSACTION::INVOICE&system_id=seller-system-it&limit=2&token=MA%3D%3D"
    assert recorder.list()[-1].step == "list"


async def test_list_records_passes_upstream_errors_through(client, upstream):
    upstream.get("/records").mock(
        return_value=httpx.Response(
            401, json={"content": {"status": 401, "code": "E_UNAUTHORIZED_ACCESS"}}
        )
    )
    with pytest.raises(UpstreamError) as raised:
        await list_records(client, "TRANSACTION::INVOICE", "seller-system-it")
    assert raised.value.status_code == 401


async def test_fetch_files_streams_the_zip_bytes(client, upstream, recorder):
    payload = b"PK\x03\x04 not really a zip"
    route = upstream.get(f"/files/{TRANSMISSION_ID}.zip").mock(
        return_value=httpx.Response(
            200, content=payload, headers={"Content-Type": "application/zip"}
        )
    )
    assert await fetch_files(client, TRANSMISSION_ID) == payload
    assert route.calls.last.request.url.path == f"/files/{TRANSMISSION_ID}.zip"
    call = recorder.list()[-1]
    assert call.step == "files"
    assert call.response.body == f"<application/zip {len(payload)} bytes>"


async def test_fetch_files_passes_upstream_errors_through(client, upstream):
    upstream.get(f"/files/{TRANSMISSION_ID}.zip").mock(
        return_value=httpx.Response(404, json={"content": {"code": "E_NOT_FOUND"}})
    )
    with pytest.raises(UpstreamError) as raised:
        await fetch_files(client, TRANSMISSION_ID)
    assert raised.value.status_code == 404


async def test_belgian_invoice_uses_peppol_invoicing(client, upstream):
    route = creation(upstream)
    operation = invoice_operation(invoicing=PEPPOL_INVOICING, inclusive="121.00")
    await create_invoice(client, "seller-system-be", operation)
    body = json.loads(route.calls[1].request.content)
    recipient = body["content"]["operation"]["recipients"][0]
    assert recipient["invoicing"] == {"type": "PEPPOL", "identifier": "0208:0987654321"}
    assert json.loads(route.calls[0].request.content)["content"]["system"]["id"] == (
        "seller-system-be"
    )


async def api_send(api, country="IT", number="2026-001", **kwargs):
    body = {
        "persona": "seller",
        "country": country,
        "operation": invoice_operation(number=number, **kwargs),
    }
    return await api.post("/api/invoices", json=body)


async def test_route_walks_send_wait_artifact_and_records_every_step():
    settings = make_settings(poll_interval_s=0.0)
    async with api_for(settings) as (_, api):
        created = await api_send(api, number="2026-600")
        assert created.status_code == 200
        body = created.json()
        assert body["state"] == "ACCEPTED"
        assert body["mode"] == "PROCESSING"

        waited = await api.get(f"/api/invoices/{body['transaction_id']}/wait")
        assert waited.status_code == 200
        transmission_id = waited.json()["transmission_id"]
        assert waited.json()["finished"] is True

        artifact = await api.get(f"/api/records/{transmission_id}/artifact")
        assert artifact.status_code == 200
        assert artifact.json()["type"] == "application/xml"
        assert "<Numero>2026-600</Numero>" in artifact.json()["xml"]

        calls = (await api.get("/api/calls")).json()
        assert [call["step"] for call in calls] == [
            "token",
            "intention",
            "transaction",
            "poll",
            "poll",
            "poll",
            "poll",
            "poll",
            "artifact",
        ]
        assert {call["persona"] for call in calls} == {"seller"}
        assert {call["mode"] for call in calls} == {"mock"}
        assert all(
            call["request"]["headers"]["Authorization"].startswith("Bearer ****")
            for call in calls[1:]
        )
        assert "Authorization" not in calls[0]["request"]["headers"]
        assert all("Bearer $FISKALY_TOKEN" in call["curl"] for call in calls[1:])
        assert calls[0]["request"]["body"]["content"]["secret"] == "***"
        assert SELLER_SECRET not in (await api.get("/api/calls")).text


async def test_route_reports_the_recipient_without_invoicing_as_terminal():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        created = await api_send(api, invoicing=None)
        waited = await api.get(f"/api/invoices/{created.json()['transaction_id']}/wait")
        body = waited.json()
        assert body["finished"] is True
        assert body["transmission"] is None
        assert body["logs"][0]["severity"] == "ERROR"
        assert "no recipient with invoicing" in body["logs"][0]["message"]


async def test_route_reports_a_failed_sdi_transmission():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        created = await api_send(api, number="FAIL-600")
        waited = await api.get(f"/api/invoices/{created.json()['transaction_id']}/wait")
        assert waited.json()["transmission"]["state"] == "FAILED"
        assert "00471" in waited.json()["transmission"]["logs"][0]["message"]


async def test_route_returns_still_processing_on_timeout():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        created = await api_send(api)
        transaction_id = created.json()["transaction_id"]
        waited = await api.get(f"/api/invoices/{transaction_id}/wait", params={"timeout": 0})
        body = waited.json()
        assert body["finished"] is False
        assert body["transaction_id"] == transaction_id
        assert body["mode"] == "PROCESSING"


async def test_route_walks_the_correction_choreography_to_its_own_transmission():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        sent = await api_send(api, number="2026-700")
        invoice_id = sent.json()["transaction_id"]
        invoice_wait = await api.get(f"/api/invoices/{invoice_id}/wait")
        invoice_transmission = invoice_wait.json()["transmission_id"]

        corrected = await api.post(
            f"/api/invoices/{invoice_id}/correction",
            json={
                "persona": "seller",
                "country": "IT",
                "operation": invoice_operation(number="2026-700-NC"),
                "reason": "two covers were never served",
            },
        )
        assert corrected.status_code == 200
        body = corrected.json()
        assert body["corrected_record_id"] == invoice_id
        assert body["intention_id"] not in (sent.json()["intention_id"], invoice_id)
        assert body["state"] == "ACCEPTED"

        waited = await api.get(f"/api/invoices/{body['transaction_id']}/wait")
        assert waited.status_code == 200
        assert waited.json()["finished"] is True
        correction_transmission = waited.json()["transmission_id"]
        assert correction_transmission != invoice_transmission

        artifact = await api.get(f"/api/records/{correction_transmission}/artifact")
        assert "<Numero>2026-700-NC</Numero>" in artifact.json()["xml"]

        steps = [call["step"] for call in (await api.get("/api/calls")).json()]
        assert steps.count("correction") == 1
        assert steps.count("intention") == 2
        assert steps.count("transaction") == 1


async def test_route_reports_a_correction_of_a_record_that_does_not_exist():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        response = await api.post(
            "/api/invoices/does-not-exist/correction",
            json={"persona": "seller", "country": "IT", "operation": invoice_operation()},
        )
        assert response.status_code == 404
        assert response.json()["code"] == "E_NOT_FOUND"
        assert "does-not-exist" in response.json()["message"]


async def test_route_serves_the_receipt_of_transmission_next_to_the_invoice_xml():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        created = await api_send(api, number="2026-701")
        waited = await api.get(f"/api/invoices/{created.json()['transaction_id']}/wait")
        transmission_id = waited.json()["transmission_id"]

        invoice = await api.get(f"/api/records/{transmission_id}/artifact")
        receipt = await api.get(
            f"/api/records/{transmission_id}/artifact", params={"kind": "receipt"}
        )
        assert invoice.json()["kind"] == "compliance"
        assert invoice.json()["label"] == "Invoice XML"
        assert receipt.json()["kind"] == "receipt"
        assert receipt.json()["label"] == "Receipt of Transmission"
        assert "FatturaElettronica" in invoice.json()["xml"]
        assert "RicevutaConsegna" in receipt.json()["xml"]
        assert invoice.json()["xml"] != receipt.json()["xml"]

        alias = await api.get(
            f"/api/records/{transmission_id}/artifact", params={"kind": "archive"}
        )
        assert alias.json() == receipt.json()


async def test_route_serves_every_artifact_as_one_zip():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        created = await api_send(api, number="2026-702")
        waited = await api.get(f"/api/invoices/{created.json()['transaction_id']}/wait")
        transmission_id = waited.json()["transmission_id"]

        response = await api.get(f"/api/records/{transmission_id}/files.zip")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert f'filename="{transmission_id}.zip"' in response.headers["content-disposition"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert sorted(archive.namelist()) == [
                "invoice.xml",
                "receipt-of-transmission.xml",
                "record.json",
            ]
            assert "<Numero>2026-702</Numero>" in archive.read("invoice.xml").decode()
            assert "RicevutaConsegna" in archive.read("receipt-of-transmission.xml").decode()
            assert json.loads(archive.read("record.json"))["content"]["id"] == transmission_id


async def test_route_lists_invoice_records_with_pagination():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        for number in ("2026-801", "2026-802", "2026-803"):
            await api_send(api, number=number)

        first = await api.get("/api/invoices", params={"country": "IT", "limit": 2})
        assert first.status_code == 200
        body = first.json()
        assert [item["type"] for item in body["results"]] == ["TRANSACTION::INVOICE"] * 2
        assert body["pagination"]["limit"] == 2
        token = body["pagination"]["token"]

        second = await api.get(
            "/api/invoices", params={"country": "IT", "limit": 2, "token": token}
        )
        assert len(second.json()["results"]) == 1
        assert second.json()["pagination"] is None
        seen = [item["id"] for item in body["results"] + second.json()["results"]]
        assert len(set(seen)) == 3


async def test_listing_defaults_to_invoices_and_can_ask_for_corrections():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        sent = await api_send(api, number="2026-804")
        invoice_id = sent.json()["transaction_id"]
        await api.post(
            f"/api/invoices/{invoice_id}/correction",
            json={
                "persona": "seller",
                "country": "IT",
                "operation": invoice_operation(number="2026-804-NC"),
            },
        )
        invoices = await api.get("/api/invoices", params={"country": "IT"})
        assert [item["type"] for item in invoices.json()["results"]] == ["TRANSACTION::INVOICE"]

        both = await api.get(
            "/api/invoices",
            params={"country": "IT", "type": "TRANSACTION::INVOICE,TRANSACTION::CORRECTION"},
        )
        assert sorted(item["type"] for item in both.json()["results"]) == [
            "TRANSACTION::CORRECTION",
            "TRANSACTION::INVOICE",
        ]


async def test_listing_names_the_missing_env_variable():
    async with api_for(make_settings(seller_system_id_it=None, uapi_mode="live")) as (app, api):
        for uapi in app.state.clients.values():
            await uapi.use(None)
        response = await api.get("/api/invoices", params={"country": "IT"})
        assert response.status_code == 409
        assert "SELLER_SYSTEM_ID_IT" in response.json()["detail"]


async def test_route_rejects_unknown_persona_country_and_kind():
    async with api_for(make_settings()) as (_, api):
        unknown_persona = await api.post(
            "/api/invoices",
            json={"persona": "auditor", "country": "IT", "operation": invoice_operation()},
        )
        assert unknown_persona.status_code == 400
        assert "auditor" in unknown_persona.json()["detail"]

        unknown_country = await api.post(
            "/api/invoices",
            json={"persona": "seller", "country": "FR", "operation": invoice_operation()},
        )
        assert unknown_country.status_code == 400
        assert "FR" in unknown_country.json()["detail"]

        unknown_kind = await api.get("/api/records/any/artifact", params={"kind": "pdf"})
        assert unknown_kind.status_code == 400
        assert "pdf" in unknown_kind.json()["detail"]


async def test_route_names_the_missing_env_variable():
    async with api_for(make_settings(seller_system_id_it=None, uapi_mode="live")) as (app, api):
        for uapi in app.state.clients.values():
            await uapi.use(None)
        response = await api_send(api)
        assert response.status_code == 409
        assert "SELLER_SYSTEM_ID_IT" in response.json()["detail"]


async def test_route_passes_upstream_errors_through_unchanged():
    async with api_for(make_settings()) as (_, api):
        response = await api.get("/api/records/does-not-exist/artifact")
        assert response.status_code == 404
        assert response.json()["code"] == "E_NOT_FOUND"


async def test_route_reports_a_missing_artifact_as_conflict():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        created = await api_send(api)
        response = await api.get(f"/api/records/{created.json()['intention_id']}/artifact")
        assert response.status_code == 409
        assert "content.compliance.artifact.data" in response.json()["detail"]
