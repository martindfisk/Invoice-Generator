import json
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx

from app.recorder import Recorder
from app.uapi import UapiClient
from tests.conftest import SELLER_KEY, SELLER_SECRET, make_settings

BASE_URL = "https://test.api.fiskaly.com"
BEARER = "eyJ.synthetic.bearer-abcd1234"


def rfc3339(moment):
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


def token_json(bearer=BEARER, expires_in=3600):
    now = datetime.now(UTC)
    return {
        "content": {
            "id": "00000000-0000-4000-8000-000000000000",
            "authentication": {
                "type": "JWT",
                "bearer": bearer,
                "expires_at": rfc3339(now + timedelta(seconds=expires_in)),
                "issued_at": rfc3339(now),
            },
            "organization": {"id": "10000000-0000-4000-8000-000000000001"},
            "subject": {"id": "20000000-0000-4000-8000-000000000001"},
        }
    }


@pytest.fixture
def recorder():
    return Recorder(50)


@pytest.fixture
def uapi(recorder):
    settings = make_settings()
    return UapiClient(settings.persona("seller"), settings, recorder)


@pytest.fixture
def upstream():
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as router:
        router.post("/tokens", name="tokens").mock(
            return_value=httpx.Response(200, json=token_json())
        )
        yield router


async def test_injects_auth_version_and_idempotency_headers(uapi, upstream):
    route = upstream.get("/systems/abc").mock(
        return_value=httpx.Response(200, json={"content": {"id": "abc"}})
    )
    response = await uapi.request("GET", "/systems/abc", step="setup")
    assert response.status_code == 200
    sent = route.calls.last.request
    assert sent.headers["Authorization"] == f"Bearer {BEARER}"
    assert sent.headers["X-Api-Version"] == "2026-06-01"
    assert "X-Idempotency-Key" not in sent.headers
    token_request = upstream["tokens"].calls.last.request
    assert token_request.headers["X-Api-Version"] == "2026-06-01"
    assert "Authorization" not in token_request.headers
    uuid.UUID(token_request.headers["X-Idempotency-Key"])
    assert json.loads(token_request.content) == {
        "content": {"type": "API_KEY", "key": SELLER_KEY, "secret": SELLER_SECRET}
    }


async def test_token_is_cached(uapi, upstream):
    upstream.get("/systems/abc").mock(return_value=httpx.Response(200, json={}))
    await uapi.request("GET", "/systems/abc")
    await uapi.request("GET", "/systems/abc")
    assert upstream["tokens"].call_count == 1


async def test_token_refreshes_when_expiry_is_near(uapi, upstream):
    upstream["tokens"].mock(return_value=httpx.Response(200, json=token_json(expires_in=30)))
    upstream.get("/systems/abc").mock(return_value=httpx.Response(200, json={}))
    await uapi.request("GET", "/systems/abc")
    await uapi.request("GET", "/systems/abc")
    assert upstream["tokens"].call_count == 2


async def test_retries_once_on_401_with_fresh_token(uapi, upstream):
    route = upstream.get("/systems/abc").mock(
        side_effect=[
            httpx.Response(401, json={"code": "E_UNAUTHORIZED_ACCESS"}),
            httpx.Response(200, json={}),
        ]
    )
    response = await uapi.request("GET", "/systems/abc")
    assert response.status_code == 200
    assert route.call_count == 2
    assert upstream["tokens"].call_count == 2


async def test_gives_up_after_second_401(uapi, upstream):
    route = upstream.get("/systems/abc").mock(return_value=httpx.Response(401, json={}))
    response = await uapi.request("GET", "/systems/abc")
    assert response.status_code == 401
    assert route.call_count == 2


async def test_idempotency_key_is_fresh_per_attempt_unless_given(uapi, upstream, recorder):
    route = upstream.post("/records").mock(
        side_effect=[
            httpx.Response(401),
            httpx.Response(201, json={"content": {"id": "rec-1"}}),
        ]
    )
    await uapi.request("POST", "/records", json={"content": {}}, step="intention")
    keys = [call.request.headers["X-Idempotency-Key"] for call in route.calls]
    assert len({uuid.UUID(key) for key in keys}) == 2
    assert recorder.list()[-1].record_id == "rec-1"

    route.mock(return_value=httpx.Response(201, json={"content": {"id": "rec-2"}}))
    fixed = str(uuid.uuid4())
    await uapi.request("POST", "/records", json={"content": {}}, idempotency_key=fixed)
    assert route.calls.last.request.headers["X-Idempotency-Key"] == fixed
    assert recorder.list()[-1].record_id == "rec-2"


async def test_recorder_receives_masked_data_only(uapi, upstream, recorder):
    upstream.get("/records/rec-9").mock(
        return_value=httpx.Response(
            200, json={"content": {"id": "rec-9"}}, headers={"X-Trace-Identifier": "trace-1"}
        )
    )
    await uapi.request("GET", "/records/rec-9", step="poll")
    token_record, call_record = recorder.list()

    assert token_record.step == "token"
    assert token_record.method == "POST"
    assert token_record.url == f"{BASE_URL}/tokens"
    assert token_record.request.body["content"]["secret"] == "***"
    assert token_record.request.body["content"]["key"] == "sell***"
    assert token_record.response.body["content"]["authentication"]["bearer"] == "***"

    assert call_record.step == "poll"
    assert call_record.persona == "seller"
    assert call_record.mode == "live"
    assert call_record.record_id == "rec-9"
    assert call_record.request.headers["Authorization"] == "Bearer ****1234"
    assert call_record.response.status == 200
    assert call_record.response.headers["X-Trace-Identifier"] == "trace-1"
    assert call_record.duration_ms >= 0
    assert "Bearer $FISKALY_TOKEN" in call_record.curl

    dump = "".join(record.model_dump_json() for record in recorder.list())
    assert SELLER_SECRET not in dump
    assert BEARER not in dump


async def test_transport_error_is_recorded_and_raised(uapi, upstream, recorder):
    upstream.get("/systems/down").mock(side_effect=httpx.ConnectError("connection refused"))
    with pytest.raises(httpx.ConnectError):
        await uapi.request("GET", "/systems/down")
    record = recorder.list()[-1]
    assert record.response is None
    assert record.error.startswith("ConnectError")


async def test_token_failure_raises(uapi, upstream):
    upstream["tokens"].mock(
        return_value=httpx.Response(401, json={"code": "E_UNAUTHORIZED_ACCESS"})
    )
    with pytest.raises(httpx.HTTPStatusError):
        await uapi.request("GET", "/systems/abc")
