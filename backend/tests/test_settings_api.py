import json

import httpx
import pytest
import respx

from app.mock import MockTransport
from app.recorder import Recorder
from app.session import BASE_URLS, SessionStore
from app.settings import REPO_ROOT
from app.uapi import MissingCredentials, UapiClient
from tests.conftest import (
    BUYER_KEY,
    BUYER_SECRET,
    SELLER_KEY,
    SELLER_SECRET,
    api_for,
    invoice_operation,
    make_settings,
)
from tests.test_uapi import BASE_URL, token_json

LIVE_BASE_URL = BASE_URLS["live"]
SESSION_KEY = "session-seller-key-9f3a"
SESSION_SECRET = "session-seller-secret-7c21"
BUYER_SESSION_KEY = "session-buyer-key-4b8e"
BUYER_SESSION_SECRET = "session-buyer-secret-2d55"
PLAINTEXT = (SESSION_KEY, SESSION_SECRET, BUYER_SESSION_KEY, BUYER_SESSION_SECRET)


def bare_settings(**overrides):
    return make_settings(
        seller_api_key=None,
        seller_api_secret=None,
        buyer_api_key=None,
        buyer_api_secret=None,
        **overrides,
    )


def seller_credentials(**extra):
    return {"personas": {"seller": {"api_key": SESSION_KEY, "api_secret": SESSION_SECRET}}, **extra}


def buyer_credentials():
    return {
        "personas": {"buyer": {"api_key": BUYER_SESSION_KEY, "api_secret": BUYER_SESSION_SECRET}}
    }


@pytest.fixture
def recorder():
    return Recorder(50)


async def test_get_settings_reports_env_credentials_without_secrets(api):
    _, client = api
    response = await client.get("/api/settings")
    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "mock"
    assert body["environment"] == "test"
    assert body["base_url"] == BASE_URL
    assert body["api_version"] == "2026-06-01"
    assert body["personas"]["seller"]["credentials"] == {
        "configured": True,
        "source": "env",
        "fingerprint": "sell***",
    }
    assert body["personas"]["buyer"]["credentials"]["fingerprint"] == "buye***"
    assert body["personas"]["seller"]["systems"]["IT"] == {
        "system_id": "seller-system-it",
        "taxpayer_id": "seller-taxpayer-it",
    }
    assert body["personas"]["buyer"]["systems"]["IT"] == {"system_id": None, "taxpayer_id": None}
    assert body["personas"]["buyer"]["recipients"] == {
        "sdi_destination_code": None,
        "peppol_id": "0208:0123456789",
    }
    for secret in (SELLER_KEY, SELLER_SECRET, BUYER_KEY, BUYER_SECRET):
        assert secret not in response.text


async def test_get_settings_reports_nothing_configured():
    async with api_for(bare_settings()) as (_, client):
        body = (await client.get("/api/settings")).json()
        for name in ("seller", "buyer"):
            assert body["personas"][name]["credentials"] == {
                "configured": False,
                "source": "none",
                "fingerprint": None,
            }


async def test_put_then_get_round_trip(api):
    _, client = api
    update = {
        "personas": {
            "seller": {
                "api_key": SESSION_KEY,
                "api_secret": SESSION_SECRET,
                "systems": {"IT": {"system_id": "sess-sys-it", "taxpayer_id": "sess-tax-it"}},
                "recipients": {
                    "sdi_destination_code": "ZZZ9999",
                    "peppol_id": "0208:1111111111",
                },
            }
        }
    }
    response = await client.put("/api/settings", json=update)
    assert response.status_code == 200
    expected = {
        "mode": "mock",
        "environment": "test",
        "base_url": BASE_URL,
        "api_version": "2026-06-01",
        "personas": {
            "seller": {
                "credentials": {
                    "configured": True,
                    "source": "session",
                    "fingerprint": "sess***",
                },
                "systems": {
                    "IT": {"system_id": "sess-sys-it", "taxpayer_id": "sess-tax-it"},
                    "BE": {"system_id": "seller-system-be", "taxpayer_id": "seller-taxpayer-be"},
                    "DE": {"system_id": None, "taxpayer_id": None},
                },
                "recipients": {
                    "sdi_destination_code": "ZZZ9999",
                    "peppol_id": "0208:1111111111",
                },
            },
            "buyer": {
                "credentials": {"configured": True, "source": "env", "fingerprint": "buye***"},
                "systems": {
                    "IT": {"system_id": None, "taxpayer_id": None},
                    "BE": {"system_id": "buyer-system-be", "taxpayer_id": "buyer-taxpayer-be"},
                    "DE": {"system_id": None, "taxpayer_id": None},
                },
                "recipients": {
                    "sdi_destination_code": None,
                    "peppol_id": "0208:0123456789",
                },
            },
        },
    }
    assert response.json() == expected
    assert (await client.get("/api/settings")).json() == expected
    for value in PLAINTEXT:
        assert value not in response.text


async def test_partial_updates_leave_everything_else_alone(api):
    _, client = api
    await client.put("/api/settings", json=seller_credentials())
    body = (await client.put("/api/settings", json=buyer_credentials())).json()
    assert body["personas"]["seller"]["credentials"]["source"] == "session"
    assert body["personas"]["buyer"]["credentials"] == {
        "configured": True,
        "source": "session",
        "fingerprint": "sess***",
    }
    systems = {"personas": {"seller": {"systems": {"BE": {"system_id": "sess-sys-be"}}}}}
    body = (await client.put("/api/settings", json=systems)).json()
    assert body["personas"]["seller"]["systems"]["BE"] == {
        "system_id": "sess-sys-be",
        "taxpayer_id": "seller-taxpayer-be",
    }
    assert body["personas"]["seller"]["credentials"]["source"] == "session"
    assert body["personas"]["seller"]["systems"]["IT"]["system_id"] == "seller-system-it"
    assert (await client.put("/api/settings", json={})).json() == body


async def test_live_environment_needs_explicit_confirmation(api):
    _, client = api
    refused = await client.put("/api/settings", json={"environment": "live"})
    assert refused.status_code == 409
    assert "confirm_live" in refused.json()["detail"]
    assert LIVE_BASE_URL in refused.json()["detail"]
    assert (await client.get("/api/settings")).json()["base_url"] == BASE_URL

    confirmed = await client.put(
        "/api/settings", json={"environment": "live", "confirm_live": True}
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["base_url"] == LIVE_BASE_URL
    assert confirmed.json()["environment"] == "live"
    assert (await client.get("/api/config")).json()["environment"] == "live"
    back = await client.put("/api/settings", json={"environment": "test"})
    assert back.json()["base_url"] == BASE_URL


async def test_mode_live_without_credentials_names_the_persona():
    async with api_for(bare_settings()) as (_, client):
        refused = await client.put("/api/settings", json={"mode": "live"})
        assert refused.status_code == 409
        assert "'seller'" in refused.json()["detail"]
        assert (await client.get("/api/settings")).json()["mode"] == "mock"

        refused = await client.put("/api/settings", json=seller_credentials(mode="live"))
        assert refused.status_code == 409
        assert "'buyer'" in refused.json()["detail"]
        assert (await client.get("/api/settings")).json()["personas"]["seller"]["credentials"][
            "source"
        ] == "none"

        await client.put("/api/settings", json=seller_credentials())
        accepted = await client.put("/api/settings", json={**buyer_credentials(), "mode": "live"})
        assert accepted.status_code == 200
        assert accepted.json()["mode"] == "live"
        assert (await client.get("/api/health")).json()["mode"] == "live"


async def test_half_a_credential_pair_is_rejected(api):
    _, client = api
    for personas in (
        {"seller": {"api_key": SESSION_KEY}},
        {"seller": {"api_secret": SESSION_SECRET}},
        {"seller": {"api_key": SESSION_KEY, "api_secret": "   "}},
    ):
        response = await client.put("/api/settings", json={"personas": personas})
        assert response.status_code == 400
        assert "api_key and api_secret must be set together" in response.json()["detail"]
    assert (await client.get("/api/settings")).json()["personas"]["seller"]["credentials"][
        "source"
    ] == "env"


async def test_unknown_persona_and_country_are_rejected(api):
    _, client = api
    response = await client.put("/api/settings", json={"personas": {"auditor": {}}})
    assert response.status_code == 400
    assert "unknown persona" in response.json()["detail"]
    response = await client.put(
        "/api/settings", json={"personas": {"seller": {"systems": {"FR": {"system_id": "x"}}}}}
    )
    assert response.status_code == 400
    assert "unknown country" in response.json()["detail"]
    response = await client.delete("/api/settings/credentials?persona=auditor")
    assert response.status_code == 400
    response = await client.put("/api/settings", json={"environment": "sandbox"})
    assert response.status_code == 422


async def test_delete_credentials_falls_back_to_env(api):
    _, client = api
    await client.put("/api/settings", json=seller_credentials())
    await client.put("/api/settings", json=buyer_credentials())
    body = (await client.delete("/api/settings/credentials?persona=seller")).json()
    assert body["personas"]["seller"]["credentials"] == {
        "configured": True,
        "source": "env",
        "fingerprint": "sell***",
    }
    assert body["personas"]["buyer"]["credentials"]["source"] == "session"
    body = (await client.delete("/api/settings/credentials")).json()
    assert {p["credentials"]["source"] for p in body["personas"].values()} == {"env"}
    assert body == (await client.get("/api/settings")).json()


async def test_delete_credentials_without_env_fallback_reports_none():
    async with api_for(bare_settings()) as (_, client):
        await client.put("/api/settings", json=seller_credentials())
        body = (await client.delete("/api/settings/credentials?persona=all")).json()
        assert body["personas"]["seller"]["credentials"] == {
            "configured": False,
            "source": "none",
            "fingerprint": None,
        }


async def test_session_credentials_never_reach_the_recorder():
    async with api_for(bare_settings()) as (_, client):
        await client.put("/api/settings", json=seller_credentials())
        passthrough = await client.get("/api/uapi/systems/seller-system-it")
        assert passthrough.status_code == 200
        listing = await client.get("/api/calls")
        assert [call["step"] for call in listing.json()] == ["token", "passthrough"]
        token_call = listing.json()[0]
        assert token_call["request"]["body"]["content"] == {
            "type": "API_KEY",
            "key": "sess***",
            "secret": "***",
        }
        assert "$FISKALY_TOKEN" in listing.json()[1]["curl"]
        for text in (listing.text, token_call["curl"], (await client.get("/api/settings")).text):
            for value in PLAINTEXT:
                assert value not in text
        stream = await client.get("/api/calls", params={"since": 0})
        for value in PLAINTEXT:
            assert value not in stream.text


async def test_put_settings_writes_nothing_to_disk():
    env_file = REPO_ROOT / ".env"
    before = env_file.read_bytes() if env_file.exists() else None
    stat_before = env_file.stat().st_mtime_ns if env_file.exists() else None
    async with api_for(bare_settings()) as (_, client):
        await client.put(
            "/api/settings",
            json={
                "personas": {
                    "seller": {
                        "api_key": SESSION_KEY,
                        "api_secret": SESSION_SECRET,
                        "systems": {"IT": {"system_id": "sess-sys-it"}},
                    }
                },
                "environment": "live",
                "confirm_live": True,
            },
        )
        await client.delete("/api/settings/credentials")
    after = env_file.read_bytes() if env_file.exists() else None
    assert after == before
    assert (env_file.stat().st_mtime_ns if env_file.exists() else None) == stat_before
    if before is not None:
        for value in PLAINTEXT:
            assert value.encode() not in before


async def test_mock_mode_needs_no_credentials_at_all():
    async with api_for(bare_settings()) as (app, client):
        assert (await client.get("/api/settings")).json()["mode"] == "mock"
        response = await client.get("/api/uapi/systems/anything")
        assert response.status_code == 200
        assert response.json()["content"]["type"] == "E_INVOICE_SERVICE"
        created = await client.post(
            "/api/invoices",
            json={"persona": "seller", "country": "IT", "operation": invoice_operation()},
        )
        assert created.status_code == 200
        assert created.json()["transaction_id"]
        assert app.state.clients["seller"].mode == "mock"


async def test_config_and_mode_still_reflect_the_session_store():
    async with api_for(bare_settings()) as (_, client):
        assert (await client.get("/api/mode")).json() == {"mode": "mock", "live_available": False}
        await client.put(
            "/api/settings",
            json={
                "personas": {
                    "seller": {
                        "api_key": SESSION_KEY,
                        "api_secret": SESSION_SECRET,
                        "systems": {"IT": {"system_id": "sess-sys-it", "taxpayer_id": "sess-tax"}},
                    },
                    "buyer": {
                        "api_key": BUYER_SESSION_KEY,
                        "api_secret": BUYER_SESSION_SECRET,
                    },
                },
            },
        )
        assert (await client.get("/api/mode")).json() == {"mode": "mock", "live_available": True}
        config = (await client.get("/api/config")).json()
        assert config["personas"]["seller"]["IT"] == {
            "system_id": "sess-sys-it",
            "taxpayer_id": "sess-tax",
        }
        assert (await client.put("/api/mode", json={"mode": "live"})).json()["mode"] == "live"


async def test_live_mode_without_credentials_fails_loudly_at_the_boundary():
    async with api_for(bare_settings()) as (_, client):
        await client.put("/api/settings", json=seller_credentials())
        await client.put("/api/settings", json={**buyer_credentials(), "mode": "live"})
        await client.delete("/api/settings/credentials?persona=seller")
        response = await client.get("/api/uapi/systems/anything")
        assert response.status_code == 409
        assert "'seller'" in response.json()["detail"]


async def test_credential_change_invalidates_the_cached_token(recorder):
    store = SessionStore(make_settings())
    client = UapiClient("seller", store, recorder)
    with respx.mock(assert_all_called=False) as router:
        tokens = router.post(f"{BASE_URL}/tokens", name="tokens").mock(
            return_value=httpx.Response(200, json=token_json())
        )
        router.get(f"{BASE_URL}/systems/abc").mock(return_value=httpx.Response(200, json={}))
        await client.request("GET", "/systems/abc")
        await client.request("GET", "/systems/abc")
        assert tokens.call_count == 1
        assert json.loads(tokens.calls.last.request.content)["content"]["key"] == SELLER_KEY

        store.set_credentials("seller", SESSION_KEY, SESSION_SECRET)
        await client.request("GET", "/systems/abc")
        assert tokens.call_count == 2
        assert json.loads(tokens.calls.last.request.content) == {
            "content": {"type": "API_KEY", "key": SESSION_KEY, "secret": SESSION_SECRET}
        }

        store.clear_credentials("seller")
        await client.request("GET", "/systems/abc")
        assert tokens.call_count == 3
        assert json.loads(tokens.calls.last.request.content)["content"]["key"] == SELLER_KEY
    await client.aclose()


async def test_environment_change_retargets_the_http_client(recorder):
    store = SessionStore(make_settings())
    client = UapiClient("seller", store, recorder)
    with respx.mock(assert_all_called=False) as router:
        for base in (BASE_URL, LIVE_BASE_URL):
            router.post(f"{base}/tokens", name=f"tokens-{base}").mock(
                return_value=httpx.Response(200, json=token_json())
            )
        router.get(f"{BASE_URL}/systems/abc").mock(return_value=httpx.Response(200, json={}))
        live = router.get(f"{LIVE_BASE_URL}/systems/abc").mock(
            return_value=httpx.Response(200, json={})
        )
        await client.request("GET", "/systems/abc")
        assert router[f"tokens-{BASE_URL}"].call_count == 1

        store.set_environment("live")
        await client.request("GET", "/systems/abc")
        assert live.call_count == 1
        assert router[f"tokens-{LIVE_BASE_URL}"].call_count == 1
        assert recorder.list()[-1].url == f"{LIVE_BASE_URL}/systems/abc"
    await client.aclose()


async def test_missing_credentials_raise_in_live_mode_only(recorder):
    live = UapiClient("seller", SessionStore(bare_settings()), recorder)
    with pytest.raises(MissingCredentials) as raised:
        await live.token()
    assert "'seller'" in str(raised.value)
    assert "SELLER_API_KEY" in str(raised.value)
    await live.aclose()

    mock = UapiClient("seller", SessionStore(bare_settings()), recorder, MockTransport())
    assert (await mock.request("GET", "/systems/anything")).status_code == 200
    await mock.aclose()
