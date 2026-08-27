import base64
import json
from pathlib import Path

import httpx
import pytest
import respx

from app.inbox import get_inbox_item, list_inbox, read_xml, simulate_delivery
from app.recorder import Recorder
from app.session import SessionStore
from app.uapi import UapiClient
from tests.conftest import api_for, invoice_operation, make_settings
from tests.test_uapi import BASE_URL, token_json

ARTIFACTS = Path(__file__).resolve().parents[1] / "fixtures" / "uapi" / "artifacts"
FATTURAPA = (ARTIFACTS / "fatturapa-invoice.xml").read_text()
UBL = (ARTIFACTS / "ubl-invoice.xml").read_text()
BUYER_IT = "buyer-system-it"


def reception(record_id, signed_at, **extra):
    return {
        "content": {
            "id": record_id,
            "type": "E_INVOICE::RECEPTION",
            "state": "COMPLETED",
            "mode": "FINISHED",
            "system": {"id": BUYER_IT},
            "journal": {"signature": "0" * 64, "signed_at": signed_at},
            "file": {"location": f"records/{record_id}.json"},
            **extra,
        }
    }


def artifact(xml):
    return {"type": "application/xml", "data": base64.b64encode(xml.encode()).decode()}


@pytest.fixture
def recorder():
    return Recorder(50)


@pytest.fixture
def client(recorder):
    store = SessionStore(make_settings(poll_interval_s=0.0))
    return UapiClient("buyer", store, recorder)


@pytest.fixture
def upstream():
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        router.post("/tokens", name="tokens").mock(
            return_value=httpx.Response(200, json=token_json())
        )
        yield router


async def test_list_inbox_queries_reception_records_newest_first(client, upstream, recorder):
    route = upstream.get("/records").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    reception("rec-old", "2026-08-25T09:00:00Z"),
                    reception("rec-new", "2026-08-26T09:00:00Z"),
                ]
            },
        )
    )
    items = await list_inbox(client, BUYER_IT)
    assert [item["id"] for item in items] == ["rec-new", "rec-old"]
    assert [item["source"] for item in items] == ["uapi", "uapi"]
    assert items[0]["xml"] is None
    assert route.calls.last.request.url.query == (
        f"type=E_INVOICE::RECEPTION&system_id={BUYER_IT}".encode()
    )
    assert recorder.list()[-1].step == "inbox"


async def test_list_inbox_filters_by_since(client, upstream):
    upstream.get("/records").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    reception("rec-old", "2026-08-25T09:00:00Z"),
                    reception("rec-new", "2026-08-26T09:00:00Z"),
                ]
            },
        )
    )
    items = await list_inbox(client, BUYER_IT, since="2026-08-25T12:00:00+00:00")
    assert [item["id"] for item in items] == ["rec-new"]


async def test_get_inbox_item_extracts_fatturapa_fields(client, upstream, recorder):
    route = upstream.get("/records/rec-it").mock(
        return_value=httpx.Response(
            200,
            json=reception(
                "rec-it",
                "2026-08-26T09:00:00Z",
                compliance={"data": "fiskaly", "artifact": artifact(FATTURAPA)},
            ),
        )
    )
    item = await get_inbox_item(client, "rec-it")
    assert item["seller_name"] == "Alpha Forniture S.r.l."
    assert item["number"] == "2026-001"
    assert item["total"] == "122.00"
    assert item["currency"] == "EUR"
    assert item["received_at"] == "2026-08-26T09:00:00Z"
    assert item["xml"].startswith("<?xml")
    assert route.calls.last.request.url.query == b"compliance-artifact&operation"
    assert recorder.list()[-1].step == "artifact"


async def test_get_inbox_item_extracts_ubl_fields(client, upstream):
    upstream.get("/records/rec-be").mock(
        return_value=httpx.Response(
            200,
            json=reception(
                "rec-be",
                "2026-08-26T09:00:00Z",
                compliance={"data": "fiskaly", "artifact": artifact(UBL)},
            ),
        )
    )
    item = await get_inbox_item(client, "rec-be")
    assert item["seller_name"] == "Alpha Supplies BV"
    assert item["number"] == "2026-001"
    assert item["total"] == "121.00"
    assert item["currency"] == "EUR"


async def test_get_inbox_item_falls_back_to_the_operation_json(client, upstream):
    operation = invoice_operation(number="2026-900", inclusive="242.00")
    operation["seller"] = {"name": "Alpha Forniture S.r.l."}
    upstream.get("/records/rec-plain").mock(
        return_value=httpx.Response(
            200,
            json=reception(
                "rec-plain",
                "2026-08-26T09:00:00Z",
                compliance={"data": "fiskaly", "artifact": artifact("<Unknown/>")},
                operation=json.dumps(operation),
            ),
        )
    )
    item = await get_inbox_item(client, "rec-plain")
    assert item["number"] == "2026-900"
    assert item["total"] == "242.00"
    assert item["seller_name"] == "Alpha Forniture S.r.l."


def test_read_xml_tolerates_unknown_and_broken_documents():
    empty = {"seller_name": None, "number": None, "total": None, "currency": None}
    assert read_xml("<Whatever><ID>1</ID></Whatever>") == empty
    assert read_xml("<not-xml") == empty
    assert read_xml("") == empty
    assert read_xml(None) == empty


def test_simulate_delivery_derives_fields_and_marks_the_source():
    store = []
    first = simulate_delivery(store, FATTURAPA, {})
    assert first["source"] == "simulated"
    assert first["seller_name"] == "Alpha Forniture S.r.l."
    assert first["number"] == "2026-001"
    assert first["xml"] == FATTURAPA
    assert first["received_at"]

    second = simulate_delivery(store, UBL, {"id": "manual-1", "seller_name": "Override BV"})
    assert store[0] is second
    assert second["id"] == "manual-1"
    assert second["seller_name"] == "Alpha Supplies BV"
    assert second["number"] == "2026-001"
    assert [item["id"] for item in store] == ["manual-1", "simulated-1"]


def test_simulate_delivery_uses_meta_for_fields_the_xml_lacks():
    store = []
    item = simulate_delivery(
        store,
        "<Unknown/>",
        {"seller_name": "Gamma SPRL", "number": "X-1", "total": "10.00", "currency": "EUR"},
    )
    assert (item["seller_name"], item["number"], item["total"]) == ("Gamma SPRL", "X-1", "10.00")


async def test_inbox_route_shows_the_invoice_the_seller_just_sent():
    settings = make_settings(poll_interval_s=0.0, buyer_system_id_it=BUYER_IT)
    async with api_for(settings) as (_, api):
        created = await api.post(
            "/api/invoices",
            json={"persona": "seller", "country": "IT", "operation": invoice_operation("2026-500")},
        )
        assert created.status_code == 200
        waited = await api.get(f"/api/invoices/{created.json()['transaction_id']}/wait")
        assert waited.json()["transmission"]["state"] == "COMPLETED"

        inbox = await api.get("/api/inbox", params={"persona": "buyer", "country": "IT"})
        assert inbox.status_code == 200
        items = inbox.json()
        assert len(items) == 1
        assert items[0]["source"] == "uapi"
        assert items[0]["number"] == "2026-500"
        assert items[0]["seller_name"] == "Alpha Forniture S.r.l."
        assert 'versione="FPR12"' in items[0]["xml"]

        seller_inbox = await api.get("/api/inbox", params={"persona": "seller", "country": "IT"})
        assert seller_inbox.json() == []


async def test_inbox_route_merges_simulated_deliveries():
    async with api_for(make_settings(poll_interval_s=0.0)) as (_, api):
        simulated = await api.post(
            "/api/inbox/simulate",
            json={"xml": UBL, "meta": {"received_at": "2026-08-26T10:00:00Z"}},
        )
        assert simulated.status_code == 200
        assert simulated.json()["source"] == "simulated"

        inbox = await api.get("/api/inbox", params={"persona": "buyer", "country": "BE"})
        ids = [item["id"] for item in inbox.json()]
        assert ids == ["simulated-1"]
        assert inbox.json()[0]["seller_name"] == "Alpha Supplies BV"

        filtered = await api.get(
            "/api/inbox",
            params={"persona": "buyer", "country": "BE", "since": "2026-08-26T11:00:00Z"},
        )
        assert filtered.json() == []


async def test_inbox_route_rejects_unknown_persona_and_country():
    async with api_for(make_settings()) as (_, api):
        bad_persona = await api.get("/api/inbox", params={"persona": "auditor", "country": "IT"})
        assert bad_persona.status_code == 400
        assert "auditor" in bad_persona.json()["detail"]

        bad_country = await api.get("/api/inbox", params={"persona": "buyer", "country": "ZZ"})
        assert bad_country.status_code == 400
        assert "ZZ" in bad_country.json()["detail"]


async def test_inbox_route_demands_a_system_id_when_reception_is_live():
    settings = make_settings(reception_mode="live", buyer_system_id_it=None, uapi_mode="live")
    async with api_for(settings) as (app, api):
        for uapi in app.state.clients.values():
            await uapi.use(None)
        response = await api.get("/api/inbox", params={"persona": "buyer", "country": "IT"})
        assert response.status_code == 409
        assert "BUYER_SYSTEM_ID_IT" in response.json()["detail"]
