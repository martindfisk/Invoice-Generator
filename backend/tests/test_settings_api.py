import json
import stat

import httpx
import pytest
import respx

from app.mock import MockTransport
from app.recorder import Recorder
from app.settings import REPO_ROOT
from app.store import BASE_URLS, SettingsStore
from app.uapi import MissingCredentials, UapiClient
from tests.conftest import (
    API_KEY,
    API_SECRET,
    api_for,
    invoice_operation,
    make_settings,
)
from tests.test_uapi import BASE_URL, token_json

LIVE_BASE_URL = BASE_URLS["live"]
STORED_KEY = "stored-key-9f3a-0000"
STORED_SECRET = "stored-secret-7c21-0000"
PLAINTEXT = (STORED_KEY, STORED_SECRET)


def bare_settings(**overrides):
    return make_settings(uapi_api_key=None, uapi_api_secret=None, **overrides)


def credentials(**extra):
    return {"api_key": STORED_KEY, "api_secret": STORED_SECRET, **extra}


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
    assert body["credentials"] == {
        "configured": True,
        "source": "env",
        "fingerprint": "test***",
    }
    assert body["systems"]["IT"] == {
        "system_id": "test-system-it",
        "taxpayer_id": "test-taxpayer-it",
    }
    assert body["systems"]["DE"] == {"system_id": None, "taxpayer_id": None}
    for secret in (API_KEY, API_SECRET):
        assert secret not in response.text


async def test_get_settings_reports_nothing_configured():
    async with api_for(bare_settings()) as (_, client):
        body = (await client.get("/api/settings")).json()
        assert body["credentials"] == {
            "configured": False,
            "source": "none",
            "fingerprint": None,
        }


async def test_put_then_get_round_trip(api):
    _, client = api
    update = {
        **credentials(),
        "systems": {"IT": {"system_id": "sess-sys-it", "taxpayer_id": "sess-tax-it"}},
    }
    response = await client.put("/api/settings", json=update)
    assert response.status_code == 200
    expected = {
        "mode": "mock",
        "environment": "test",
        "base_url": BASE_URL,
        "api_version": "2026-06-01",
        "credentials": {"configured": True, "source": "stored", "fingerprint": "stor***"},
        "systems": {
            "IT": {"system_id": "sess-sys-it", "taxpayer_id": "sess-tax-it"},
            "BE": {"system_id": "test-system-be", "taxpayer_id": "test-taxpayer-be"},
            "DE": {"system_id": None, "taxpayer_id": None},
        },
    }
    assert response.json() == expected
    assert (await client.get("/api/settings")).json() == expected
    for value in PLAINTEXT:
        assert value not in response.text


async def test_partial_updates_leave_everything_else_alone(api):
    _, client = api
    await client.put("/api/settings", json=credentials())
    body = (
        await client.put("/api/settings", json={"systems": {"BE": {"system_id": "sess-sys-be"}}})
    ).json()
    assert body["systems"]["BE"] == {
        "system_id": "sess-sys-be",
        "taxpayer_id": "test-taxpayer-be",
    }
    assert body["credentials"]["source"] == "stored"
    assert body["systems"]["IT"]["system_id"] == "test-system-it"
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


async def test_mode_live_without_credentials_is_refused():
    async with api_for(bare_settings()) as (_, client):
        refused = await client.put("/api/settings", json={"mode": "live"})
        assert refused.status_code == 409
        assert "no API credentials configured" in refused.json()["detail"]
        assert (await client.get("/api/settings")).json()["mode"] == "mock"

        accepted = await client.put("/api/settings", json=credentials(mode="live"))
        assert accepted.status_code == 200
        assert accepted.json()["mode"] == "live"
        assert (await client.get("/api/health")).json()["mode"] == "live"


async def test_half_a_credential_pair_is_rejected(api):
    _, client = api
    for update in (
        {"api_key": STORED_KEY},
        {"api_secret": STORED_SECRET},
        {"api_key": STORED_KEY, "api_secret": "   "},
    ):
        response = await client.put("/api/settings", json=update)
        assert response.status_code == 400
        assert "api_key and api_secret must be set together" in response.json()["detail"]
    assert (await client.get("/api/settings")).json()["credentials"]["source"] == "env"


async def test_unknown_country_and_environment_are_rejected(api):
    _, client = api
    response = await client.put("/api/settings", json={"systems": {"FR": {"system_id": "x"}}})
    assert response.status_code == 400
    assert "unknown country" in response.json()["detail"]
    response = await client.put("/api/settings", json={"environment": "sandbox"})
    assert response.status_code == 422


async def test_delete_credentials_overrides_the_env_fallback(api):
    _, client = api
    assert (await client.get("/api/settings")).json()["credentials"]["source"] == "env"
    body = (await client.delete("/api/settings/credentials")).json()
    # An explicit clear is authoritative: the .env credentials must not silently come back.
    assert body["credentials"] == {"configured": False, "source": "none", "fingerprint": None}
    assert body == (await client.get("/api/settings")).json()


async def test_delete_credentials_after_a_stored_pair_reports_none():
    async with api_for(bare_settings()) as (_, client):
        await client.put("/api/settings", json=credentials())
        body = (await client.delete("/api/settings/credentials")).json()
        assert body["credentials"] == {
            "configured": False,
            "source": "none",
            "fingerprint": None,
        }


async def test_stored_credentials_never_reach_the_recorder():
    async with api_for(bare_settings()) as (_, client):
        await client.put("/api/settings", json=credentials())
        passthrough = await client.get("/api/uapi/systems/test-system-it")
        assert passthrough.status_code == 200
        listing = await client.get("/api/calls")
        assert [call["step"] for call in listing.json()] == ["token", "passthrough"]
        token_call = listing.json()[0]
        assert token_call["request"]["body"]["content"] == {
            "type": "API_KEY",
            "key": "stor***",
            "secret": "***",
        }
        assert "$FISKALY_TOKEN" in listing.json()[1]["curl"]
        for text in (listing.text, token_call["curl"], (await client.get("/api/settings")).text):
            for value in PLAINTEXT:
                assert value not in text
        stream = await client.get("/api/calls", params={"since": 0})
        for value in PLAINTEXT:
            assert value not in stream.text


async def test_put_settings_writes_nothing_to_the_env_file():
    env_file = REPO_ROOT / ".env"
    before = env_file.read_bytes() if env_file.exists() else None
    stat_before = env_file.stat().st_mtime_ns if env_file.exists() else None
    async with api_for(bare_settings()) as (_, client):
        await client.put(
            "/api/settings",
            json={
                **credentials(),
                "systems": {"IT": {"system_id": "sess-sys-it"}},
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
            "/api/invoices", json={"country": "IT", "operation": invoice_operation()}
        )
        assert created.status_code == 200
        assert created.json()["transaction_id"]
        assert app.state.client.mode == "mock"


async def test_config_and_mode_reflect_the_settings_store():
    async with api_for(bare_settings()) as (_, client):
        assert (await client.get("/api/mode")).json() == {"mode": "mock", "live_available": False}
        await client.put(
            "/api/settings",
            json={
                **credentials(),
                "systems": {"IT": {"system_id": "sess-sys-it", "taxpayer_id": "sess-tax"}},
            },
        )
        assert (await client.get("/api/mode")).json() == {"mode": "mock", "live_available": True}
        config = (await client.get("/api/config")).json()
        assert config["systems"]["IT"] == {
            "system_id": "sess-sys-it",
            "taxpayer_id": "sess-tax",
        }
        assert (await client.put("/api/mode", json={"mode": "live"})).json()["mode"] == "live"


async def test_live_mode_without_credentials_fails_loudly_at_the_boundary():
    async with api_for(bare_settings()) as (_, client):
        await client.put("/api/settings", json=credentials(mode="live"))
        await client.delete("/api/settings/credentials")
        response = await client.get("/api/uapi/systems/anything")
        assert response.status_code == 409
        assert "no API credentials configured" in response.json()["detail"]


async def test_settings_survive_a_restart(tmp_path):
    settings_file = tmp_path / ".uapi-settings.json"
    async with api_for(make_settings(uapi_settings_file=settings_file)) as (_, client):
        await client.put(
            "/api/settings",
            json={**credentials(), "systems": {"DE": {"system_id": "sess-sys-de"}}},
        )
    async with api_for(make_settings(uapi_settings_file=settings_file)) as (_, client):
        body = (await client.get("/api/settings")).json()
        assert body["credentials"] == {
            "configured": True,
            "source": "stored",
            "fingerprint": "stor***",
        }
        assert body["systems"]["DE"]["system_id"] == "sess-sys-de"


async def test_saved_mode_survives_a_restart(tmp_path):
    settings_file = tmp_path / ".uapi-settings.json"
    async with api_for(make_settings(uapi_settings_file=settings_file)) as (_, client):
        accepted = await client.put("/api/settings", json={"mode": "live"})
        assert accepted.status_code == 200
    # The rebuilt Settings still says mock (as .env would); the persisted file wins.
    async with api_for(make_settings(uapi_settings_file=settings_file)) as (app, client):
        assert (await client.get("/api/health")).json()["mode"] == "live"
        assert app.state.client.mode == "live"


async def test_cleared_credentials_survive_a_restart_over_env_ones(tmp_path):
    settings_file = tmp_path / ".uapi-settings.json"
    async with api_for(make_settings(uapi_settings_file=settings_file)) as (_, client):
        await client.delete("/api/settings/credentials")
    rebuilt = make_settings(uapi_settings_file=settings_file)
    store = SettingsStore(rebuilt)
    assert store.credential_state() == {"configured": False, "source": "none", "fingerprint": None}
    async with api_for(rebuilt) as (_, client):
        body = (await client.get("/api/settings")).json()
        assert body["credentials"]["configured"] is False
        assert body["credentials"]["source"] == "none"


def test_set_environment_drops_the_persisted_token():
    store = SettingsStore(make_settings())
    store.set_token("eyJ.synthetic.bearer-abcd1234", 4102444800.0)
    assert store.token()[0] == "eyJ.synthetic.bearer-abcd1234"
    store.set_environment("live")
    assert store.token() == (None, 0.0)
    assert store.base_url == LIVE_BASE_URL


async def test_a_live_minted_token_is_reused_after_a_restart(tmp_path, recorder):
    settings_file = tmp_path / ".uapi-settings.json"
    first = UapiClient(SettingsStore(make_settings(uapi_settings_file=settings_file)), recorder)
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        tokens = router.post("/tokens", name="tokens").mock(
            return_value=httpx.Response(200, json=token_json())
        )
        router.get("/systems/abc").mock(return_value=httpx.Response(200, json={}))
        await first.request("GET", "/systems/abc")
        assert tokens.call_count == 1
        await first.aclose()

        second = UapiClient(
            SettingsStore(make_settings(uapi_settings_file=settings_file)), recorder
        )
        response = await second.request("GET", "/systems/abc")
        assert response.status_code == 200
        assert tokens.call_count == 1
        await second.aclose()


async def test_the_settings_file_is_written_with_owner_only_permissions(tmp_path):
    settings_file = tmp_path / ".uapi-settings.json"
    async with api_for(make_settings(uapi_settings_file=settings_file)) as (_, client):
        await client.put("/api/settings", json=credentials())
    assert stat.S_IMODE(settings_file.stat().st_mode) == 0o600
    assert json.loads(settings_file.read_text())["api_key"] == STORED_KEY


async def test_credential_change_invalidates_the_cached_token(recorder):
    store = SettingsStore(make_settings())
    client = UapiClient(store, recorder)
    with respx.mock(assert_all_called=False) as router:
        tokens = router.post(f"{BASE_URL}/tokens", name="tokens").mock(
            return_value=httpx.Response(200, json=token_json())
        )
        router.get(f"{BASE_URL}/systems/abc").mock(return_value=httpx.Response(200, json={}))
        await client.request("GET", "/systems/abc")
        await client.request("GET", "/systems/abc")
        assert tokens.call_count == 1
        assert json.loads(tokens.calls.last.request.content)["content"]["key"] == API_KEY

        store.set_credentials(STORED_KEY, STORED_SECRET)
        await client.request("GET", "/systems/abc")
        assert tokens.call_count == 2
        assert json.loads(tokens.calls.last.request.content) == {
            "content": {"type": "API_KEY", "key": STORED_KEY, "secret": STORED_SECRET}
        }

        store.clear_credentials()
        with pytest.raises(MissingCredentials):
            await client.request("GET", "/systems/abc")
    await client.aclose()


async def test_environment_change_retargets_the_http_client(recorder):
    store = SettingsStore(make_settings())
    client = UapiClient(store, recorder)
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
    live = UapiClient(SettingsStore(bare_settings()), recorder)
    with pytest.raises(MissingCredentials) as raised:
        await live.token()
    assert "settings dialog" in str(raised.value)
    assert "UAPI_API_KEY" in str(raised.value)
    await live.aclose()

    mock = UapiClient(SettingsStore(bare_settings()), recorder, MockTransport())
    assert (await mock.request("GET", "/systems/anything")).status_code == 200
    await mock.aclose()
