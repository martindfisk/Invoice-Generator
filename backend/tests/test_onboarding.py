import httpx
import respx

from app.onboarding import onboarding_status, provision
from app.recorder import Recorder
from app.session import SessionStore
from app.uapi import UapiClient
from tests.conftest import PEPPOL_INVOICING, api_for, invoice_operation, make_settings
from tests.test_uapi import BASE_URL, token_json

FISCONLINE = {
    "fiscalization": {
        "credentials": {
            "pin": "1234567890",
            "password": "pw-0123456789",
            "tax_id_number": "JPGQDJ23T28M105V",
        }
    }
}


async def provision_country(client, country, persona="seller", **extra):
    return await client.post(
        "/api/onboarding/provision",
        json={"persona": persona, "country": country, "confirm": True, **extra},
    )


async def test_status_on_an_empty_account(api):
    _, client = api
    response = await client.get("/api/onboarding/status?persona=seller")
    assert response.status_code == 200
    body = response.json()
    assert body["persona"] == "seller"
    assert body["environment"] == "test"
    assert body["credentials"]["configured"] is True
    assert body["counts"] == {"organizations": 0, "subjects": 0, "taxpayers": 0, "systems": 0}
    assert body["taxpayers"] == []
    assert body["systems"] == []
    assert body["ready"] == {"IT": False, "BE": False, "DE": False}
    assert body["missing"] == ["IT: no taxpayer", "BE: no taxpayer", "DE: no taxpayer"]


async def test_status_without_credentials_reports_instead_of_erroring():
    store = SessionStore(make_settings(seller_api_key=None, seller_api_secret=None))
    client = UapiClient("seller", store, Recorder(10), None)
    body = await onboarding_status(client, store)
    assert body["credentials"] == {"configured": False, "source": "none", "fingerprint": None}
    assert body["counts"] == {"organizations": 0, "subjects": 0, "taxpayers": 0, "systems": 0}
    assert body["ready"] == {"IT": False, "BE": False, "DE": False}
    assert body["missing"] == ["no API credentials configured"]
    assert body["organizations"] == []
    assert body["subjects"] == []
    await client.aclose()


async def test_status_tree_fields_on_a_fresh_account(api):
    _, client = api
    body = (await client.get("/api/onboarding/status?persona=seller")).json()
    assert body["organizations"] == []
    assert body["subjects"] == []
    assert body["taxpayers"] == []
    assert body["systems"] == []
    assert body["counts"] == {"organizations": 0, "subjects": 0, "taxpayers": 0, "systems": 0}


async def test_status_tree_fields_after_de_provision(api):
    _, client = api
    created = (await provision_country(client, "DE")).json()["created"]
    status = (await client.get("/api/onboarding/status?persona=seller")).json()
    taxpayer = status["taxpayers"][0]
    assert taxpayer["id"] == created["taxpayer_id"]
    assert taxpayer["vat_id"] == "DE123456789"
    assert taxpayer["fiscalization_type"] == "DE"
    system = status["systems"][0]
    assert system["id"] == created["system_id"]
    assert system["location_id"] == created["taxpayer_id"]
    assert system["taxpayer_id"] == created["taxpayer_id"]
    assert system["registrations"] == [{"type": "PEPPOL"}]
    assert system["blocked_by"] is None


async def test_status_lists_entities_and_flags_blocked_peppol_systems():
    store = SessionStore(make_settings())
    client = UapiClient("seller", store, Recorder(50), None)

    def listing(*contents):
        return httpx.Response(200, json={"results": [{"content": c} for c in contents]})

    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        router.post("/tokens").mock(return_value=httpx.Response(200, json=token_json()))
        router.get("/organizations").mock(
            return_value=listing(
                {"id": "org-1", "type": "UNIT", "state": "ENABLED", "name": "demo-unit"}
            )
        )
        router.get("/subjects").mock(
            return_value=listing(
                {"id": "sub-1", "type": "API_KEY", "state": "ENABLED", "name": "demo-key"}
            )
        )
        router.get("/taxpayers").mock(
            return_value=listing(
                {
                    "id": "tax-de",
                    "state": "COMMISSIONED",
                    "country": "DE",
                    "name": {"legal": "Musterfirma GmbH"},
                    "vat_number": "DE123456789",
                    "fiscalization": {"type": "DE", "vat_id_number": "123456789"},
                },
                {
                    "id": "tax-it",
                    "state": "COMMISSIONED",
                    "country": "IT",
                    "name": {"legal": "Azienda Dimostrativa S.r.l."},
                    "fiscalization": {"type": "IT", "vat_id_number": "99999999990"},
                },
            )
        )
        router.get("/systems").mock(
            return_value=listing(
                {
                    "id": "sys-de",
                    "type": "E_INVOICE_SERVICE",
                    "state": "COMMISSIONED",
                    "mode": "DEGRADED",
                    "location": {"id": "tax-de"},
                    "registrations": [{"type": "PEPPOL"}],
                },
                {
                    "id": "sys-it",
                    "type": "E_INVOICE_SERVICE",
                    "state": "COMMISSIONED",
                    "mode": "DEGRADED",
                    "location": {"id": "tax-it"},
                    "registrations": [{"type": "SDI"}],
                },
            )
        )
        body = await onboarding_status(client, store)
    assert body["organizations"] == [
        {"id": "org-1", "type": "UNIT", "state": "ENABLED", "name": "demo-unit"}
    ]
    assert body["subjects"] == [
        {"id": "sub-1", "type": "API_KEY", "state": "ENABLED", "name": "demo-key"}
    ]
    assert body["counts"]["organizations"] == 1
    assert body["counts"]["subjects"] == 1
    taxpayer = body["taxpayers"][0]
    assert taxpayer["vat_id"] == "DE123456789"
    assert taxpayer["fiscalization_type"] == "DE"
    assert body["taxpayers"][1]["vat_id"] == "99999999990"
    systems = {system["id"]: system for system in body["systems"]}
    assert systems["sys-de"]["location_id"] == "tax-de"
    assert systems["sys-de"]["registrations"] == [{"type": "PEPPOL"}]
    assert systems["sys-de"]["blocked_by"] == "peppol-proof-of-ownership"
    assert systems["sys-it"]["blocked_by"] is None
    assert any("sys-de is COMMISSIONED/DEGRADED" in message for message in body["missing"])
    assert body["errors"] == {}
    await client.aclose()


async def test_status_names_a_failed_listing_instead_of_blanking_the_tree():
    store = SessionStore(make_settings())
    client = UapiClient("seller", store, Recorder(50), None)

    def listing(*contents):
        return httpx.Response(200, json={"results": [{"content": c} for c in contents]})

    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        router.post("/tokens").mock(return_value=httpx.Response(200, json=token_json()))
        router.get("/organizations").mock(
            return_value=httpx.Response(
                403, json={"status": 403, "code": "E_FORBIDDEN", "message": "no access"}
            )
        )
        router.get("/subjects").mock(return_value=listing({"id": "sub-1", "state": "ENABLED"}))
        router.get("/taxpayers").mock(return_value=listing())
        router.get("/systems").mock(return_value=listing())
        body = await onboarding_status(client, store)
    # The failed resource is named; the ones that answered still render.
    assert list(body["errors"]) == ["organizations"]
    assert body["organizations"] == []
    assert body["subjects"] == [{"id": "sub-1", "type": None, "state": "ENABLED", "name": None}]
    assert any(
        message.startswith("organizations could not be listed") for message in body["missing"]
    )
    assert body["ready"] == {"IT": False, "BE": False, "DE": False}
    # The response model must carry the errors dict, or the route strips it and the UI never
    # learns a resource is unknown rather than absent.
    from app.models import OnboardingStatus

    assert OnboardingStatus(**body).model_dump()["errors"] == body["errors"]
    await client.aclose()


async def test_provision_without_confirm_is_refused(api):
    _, client = api
    response = await client.post(
        "/api/onboarding/provision", json={"persona": "seller", "country": "DE"}
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "confirm=true" in detail
    assert "test environment" in detail
    assert "TEST resources are not billed" in detail
    assert (await client.get("/api/uapi/taxpayers")).json() == {"results": []}


async def test_provision_unknown_country_and_persona_are_rejected(api):
    _, client = api
    response = await provision_country(client, "FR")
    assert response.status_code == 400
    assert "unknown country" in response.json()["detail"]
    response = await provision_country(client, "DE", persona="auditor")
    assert response.status_code == 400
    assert "unknown persona" in response.json()["detail"]


async def test_provision_de_then_status_ready_then_send(api):
    _, client = api
    response = await provision_country(client, "DE")
    assert response.status_code == 200
    body = response.json()
    assert [(step["name"], step["status"]) for step in body["steps"]] == [
        ("create taxpayer", "passed"),
        ("commission taxpayer", "passed"),
        ("create system", "passed"),
        ("commission system", "passed"),
        ("verify system", "passed"),
    ]
    assert body["ready"] is True
    created = body["created"]
    assert created["taxpayer_id"] and created["system_id"]
    assert created["location_id"] is None

    settings = (await client.get("/api/settings")).json()
    assert settings["personas"]["seller"]["systems"]["DE"] == {
        "system_id": created["system_id"],
        "taxpayer_id": created["taxpayer_id"],
    }

    status = (await client.get("/api/onboarding/status?persona=seller")).json()
    assert status["counts"]["taxpayers"] == 1
    assert status["counts"]["systems"] == 1
    assert status["ready"] == {"IT": False, "BE": False, "DE": True}
    assert status["missing"] == ["IT: no taxpayer", "BE: no taxpayer"]
    assert status["taxpayers"][0]["country"] == "DE"
    assert status["taxpayers"][0]["state"] == "COMMISSIONED"
    system = status["systems"][0]
    assert system["taxpayer_id"] == created["taxpayer_id"]
    assert system["compliance_state"] == "TRANSMISSION_RECEPTION"
    assert system["peppol_id"] == "9930:DE123456789"

    sent = await client.post(
        "/api/invoices",
        json={
            "persona": "seller",
            "country": "DE",
            "operation": invoice_operation(invoicing=PEPPOL_INVOICING),
        },
    )
    assert sent.status_code == 200
    transaction_id = sent.json()["transaction_id"]
    waited = await client.get(f"/api/invoices/{transaction_id}/wait?timeout=5")
    assert waited.json()["finished"] is True
    assert waited.json()["transmission"]["state"] == "COMPLETED"


async def test_provision_it_requires_fisconline_secrets(api):
    _, client = api
    response = await provision_country(client, "IT")
    assert response.status_code == 400
    detail = response.json()["detail"]
    for path in (
        "fiscalization.credentials.pin",
        "fiscalization.credentials.password",
        "fiscalization.credentials.tax_id_number",
    ):
        assert path in detail
    assert "never defaulted" in detail

    response = await provision_country(client, "IT", taxpayer=FISCONLINE)
    assert response.status_code == 200
    assert response.json()["ready"] is True

    calls = (await client.get("/api/calls")).json()
    create = next(
        call for call in calls if call["method"] == "POST" and call["url"].endswith("/taxpayers")
    )
    credentials = create["request"]["body"]["content"]["fiscalization"]["credentials"]
    assert credentials["pin"] == "***"
    assert credentials["password"] == "***"
    assert "pw-0123456789" not in str(calls)


async def test_provision_reuse_adopts_the_existing_taxpayer_and_system(api):
    _, client = api
    first = (await provision_country(client, "DE")).json()
    second = (await provision_country(client, "DE")).json()
    assert [(step["name"], step["status"]) for step in second["steps"]] == [
        ("create taxpayer", "skipped"),
        ("commission taxpayer", "skipped"),
        ("create system", "skipped"),
        ("commission system", "skipped"),
        ("verify system", "passed"),
    ]
    assert second["created"] == first["created"]
    assert second["ready"] is True
    listing = (await client.get("/api/uapi/taxpayers")).json()
    assert len(listing["results"]) == 1


async def test_provision_reuse_false_refuses_a_duplicate(api):
    _, client = api
    assert (await provision_country(client, "DE")).status_code == 200
    response = await provision_country(client, "DE", reuse=False)
    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]
    assert "reuse=true" in response.json()["detail"]


async def test_provision_stops_at_the_first_failure_and_returns_partial_steps():
    store = SessionStore(make_settings())
    recorder = Recorder(50)
    client = UapiClient("seller", store, recorder, None)
    taxpayer_id = "70000000-0000-4000-8000-000000000001"
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        router.post("/tokens").mock(return_value=httpx.Response(200, json=token_json()))
        router.get("/taxpayers").mock(return_value=httpx.Response(200, json={"results": []}))
        router.post("/taxpayers").mock(
            return_value=httpx.Response(
                200, json={"content": {"id": taxpayer_id, "state": "ACQUIRED"}}
            )
        )
        router.patch(f"/taxpayers/{taxpayer_id}").mock(
            return_value=httpx.Response(
                200, json={"content": {"id": taxpayer_id, "state": "COMMISSIONED"}}
            )
        )
        router.post("/systems").mock(
            return_value=httpx.Response(
                422,
                json={
                    "content": {
                        "status": 422,
                        "code": "E_UNPROCESSABLE_CONTENT",
                        "error": "Unprocessable Content",
                        "message": "registrations not supported for this taxpayer",
                    }
                },
            )
        )
        result = await provision(
            client, store, "DE", {"type": "COMPANY", "name": {}, "address": {}}
        )
    assert [(step["name"], step["status"]) for step in result["steps"]] == [
        ("create taxpayer", "passed"),
        ("commission taxpayer", "passed"),
        ("create system", "failed"),
        ("commission system", "skipped"),
        ("verify system", "skipped"),
    ]
    assert result["steps"][2]["error"]["code"] == "E_UNPROCESSABLE_CONTENT"
    assert result["created"] == {
        "taxpayer_id": taxpayer_id,
        "location_id": None,
        "system_id": None,
    }
    assert result["ready"] is False
    assert store.persona("seller").systems["DE"] is None
    await client.aclose()


async def test_de_is_accepted_everywhere_it_and_be_are(api):
    _, client = api
    update = {
        "personas": {
            "seller": {
                "systems": {"DE": {"system_id": "sess-sys-de", "taxpayer_id": "sess-tax-de"}}
            }
        }
    }
    body = (await client.put("/api/settings", json=update)).json()
    assert body["personas"]["seller"]["systems"]["DE"] == {
        "system_id": "sess-sys-de",
        "taxpayer_id": "sess-tax-de",
    }
    config = (await client.get("/api/config")).json()
    assert config["personas"]["seller"]["DE"] == {
        "system_id": "sess-sys-de",
        "taxpayer_id": "sess-tax-de",
    }
    validated = await client.post(
        "/api/validate/uapi",
        json={"country": "DE", "operation": invoice_operation(invoicing=PEPPOL_INVOICING)},
    )
    assert validated.status_code == 200
    assert validated.json()["country"] == "DE"


async def test_mock_send_works_for_de_without_provisioning():
    async with api_for(make_settings()) as (_, client):
        response = await client.post(
            "/api/invoices",
            json={
                "persona": "seller",
                "country": "DE",
                "operation": invoice_operation(invoicing=PEPPOL_INVOICING),
            },
        )
        assert response.status_code == 200
        assert response.json()["state"] == "ACCEPTED"
