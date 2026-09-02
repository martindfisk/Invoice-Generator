import uuid

from app.mock import MockTransport
from tests.conftest import (
    BUYER_KEY,
    BUYER_SECRET,
    SELLER_KEY,
    SELLER_SECRET,
    api_for,
    make_settings,
)


async def test_health(api):
    _, client = api
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "mode": "mock", "api_version": "2026-06-01"}


async def test_config_exposes_systems_but_no_secrets(api):
    _, client = api
    response = await client.get("/api/config")
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "mock"
    assert body["environment"] == "test"
    assert body["api_version"] == "2026-06-01"
    assert body["reception_mode"] == "simulated"
    assert body["personas"]["seller"]["BE"] == {
        "system_id": "seller-system-be",
        "taxpayer_id": "seller-taxpayer-be",
    }
    assert set(body["personas"]["seller"]) == {"IT", "BE"}
    assert set(body["personas"]["buyer"]) == {"BE"}
    for secret in (SELLER_KEY, SELLER_SECRET, BUYER_KEY, BUYER_SECRET):
        assert secret not in response.text


async def test_mode_switch_to_live_refused_without_credentials():
    settings = make_settings(buyer_api_key=None, buyer_api_secret=None)
    async with api_for(settings) as (_, client):
        response = await client.put("/api/mode", json={"mode": "live"})
        assert response.status_code == 409
        assert "BUYER_API_KEY" in response.json()["detail"]
        assert (await client.get("/api/mode")).json() == {"mode": "mock", "live_available": False}


async def test_mode_switch_does_not_depend_on_override_flag():
    async with api_for(make_settings(allow_mode_override=False)) as (_, client):
        assert (await client.get("/api/mode")).json() == {"mode": "mock", "live_available": True}
        response = await client.put("/api/mode", json={"mode": "live"})
        assert response.status_code == 200
        assert response.json() == {"mode": "live", "live_available": True}


async def test_mode_switch_round_trip(api):
    app, client = api
    assert (await client.put("/api/mode", json={"mode": "live"})).json()["mode"] == "live"
    assert (await client.get("/api/health")).json()["mode"] == "live"
    assert {c.mode for c in app.state.clients.values()} == {"live"}
    assert (await client.put("/api/mode", json={"mode": "mock"})).json()["mode"] == "mock"
    assert (await client.get("/api/config")).json()["mode"] == "mock"
    assert (await client.put("/api/mode", json={"mode": "bogus"})).status_code == 422


async def test_passthrough_in_mock_mode_records_calls(api):
    _, client = api
    response = await client.get("/api/uapi/systems/buyer-system-be", headers={"X-Persona": "buyer"})
    assert response.status_code == 200
    body = response.json()
    assert body["content"]["type"] == "E_INVOICE_SERVICE"
    assert body["content"]["annotations"] == {"peppol_id": "0208:0123456789"}
    assert "_fixture" not in body
    assert response.headers["X-Trace-Identifier"]
    assert response.headers["X-Api-Version"] == "2026-06-01"

    listing = await client.get("/api/calls")
    calls = listing.json()
    assert [call["step"] for call in calls] == ["token", "passthrough"]
    assert {call["persona"] for call in calls} == {"buyer"}
    assert {call["mode"] for call in calls} == {"mock"}
    assert calls[1]["method"] == "GET"
    assert calls[1]["url"] == "https://test.api.fiskaly.com/systems/buyer-system-be"
    assert calls[1]["response"]["status"] == 200
    assert calls[1]["request"]["headers"]["X-Api-Version"] == "2026-06-01"
    assert calls[0]["request"]["body"]["content"]["secret"] == "***"
    assert BUYER_SECRET not in listing.text

    since = await client.get("/api/calls", params={"since": calls[0]["id"]})
    assert [call["id"] for call in since.json()] == [calls[1]["id"]]


async def test_passthrough_forwards_idempotency_key_and_query(api):
    _, client = api
    key = str(uuid.uuid4())
    response = await client.post(
        "/api/uapi/records?limit=1", json={"content": {}}, headers={"X-Idempotency-Key": key}
    )
    assert response.status_code == 404
    assert response.json()["content"]["code"] == "E_NOT_FOUND"
    call = (await client.get("/api/calls")).json()[-1]
    assert call["persona"] == "seller"
    assert call["url"] == "https://test.api.fiskaly.com/records?limit=1"
    assert call["request"]["headers"]["X-Idempotency-Key"] == key
    assert call["request"]["body"] == {"content": {}}


async def test_passthrough_rejects_unknown_persona_and_bad_json(api):
    _, client = api
    response = await client.get("/api/uapi/systems/x", headers={"X-Persona": "auditor"})
    assert response.status_code == 400
    response = await client.post(
        "/api/uapi/records", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert (await client.get("/api/calls")).json() == []


async def test_passthrough_surfaces_token_failure(api, tmp_path):
    app, client = api
    for uapi in app.state.clients.values():
        await uapi.use(MockTransport(tmp_path))
    response = await client.get("/api/uapi/systems/x")
    assert response.status_code == 404
    assert "POST_tokens.json" in response.json()["content"]["message"]


async def test_mock_mode_does_not_require_configured_system_ids(api):
    _, client = api
    response = await client.get("/api/inbox?persona=buyer&country=IT")
    assert response.status_code == 200


async def test_live_mode_still_demands_a_configured_system_id():
    settings = make_settings(uapi_mode="live", reception_mode="live", buyer_system_id_it=None)
    async with api_for(settings) as (app, client):
        for uapi in app.state.clients.values():
            await uapi.use(None)
        response = await client.get("/api/inbox?persona=buyer&country=IT")
        assert response.status_code == 409
        assert "BUYER_SYSTEM_ID_IT" in response.json()["detail"]


async def test_spec_fields_describes_the_payload_surface(api):
    _, client = api
    params = {"country": "IT", "operation": "INVOICE"}
    response = await client.get("/api/spec/fields", params=params)
    assert response.status_code == 200
    body = response.json()
    assert body["profile"] == "IT_EI"
    assert body["api_version"] == "2026-06-01"
    assert body["source_sha256"]
    assert body["warnings"] == []
    leaves = [field for field in body["fields"] if field["kind"] == "leaf"]
    assert len(leaves) == 242
    assert len(body["unions"]) == 14
    wanted = "/document/references/purchase_order"
    order = next(field for field in body["fields"] if field["pointer"] == wanted)
    assert order["example"] == "PO-2025-001234"
    assert order["required"] is False
    assert order["schema"] == "AlphaNumerical32"


async def test_spec_fields_answers_304_for_an_unchanged_spec(api):
    _, client = api
    first = await client.get("/api/spec/fields", params={"country": "IT"})
    etag = first.headers["etag"]
    assert etag.startswith('W/"')
    again = await client.get(
        "/api/spec/fields", params={"country": "IT"}, headers={"If-None-Match": etag}
    )
    assert again.status_code == 304
    other = await client.get(
        "/api/spec/fields",
        params={"country": "IT", "operation": "CORRECTION"},
        headers={"If-None-Match": etag},
    )
    assert other.status_code == 200


async def test_spec_fields_rejects_an_unknown_country_or_operation(api):
    _, client = api
    unknown = await client.get("/api/spec/fields", params={"country": "FR"})
    assert unknown.status_code == 422
    bad = await client.get("/api/spec/fields", params={"operation": "RECEIPT"})
    assert bad.status_code == 422


async def test_only_the_passthrough_claims_the_uapi_prefix():
    # /api/uapi/{path:path} forwards upstream to test.api.fiskaly.com. Any other route nested
    # under it would be swallowed and sent to fiskaly as a real call, and logged as one.
    from app.routes import router

    under = {
        route.path
        for route in router.routes
        if route.path.startswith("/api/uapi") and route.path != "/api/validate/uapi"
    }
    assert under == {"/api/uapi/{path:path}"}
