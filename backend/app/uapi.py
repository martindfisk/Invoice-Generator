import asyncio
import time
import uuid
from datetime import datetime

import httpx

from app.mask import mask_headers, mask_json, to_curl
from app.recorder import CallRecord, CallRequest, CallResponse

REFRESH_MARGIN_S = 60
REQUEST_TIMEOUT_S = 30.0
IDEMPOTENT_METHODS = frozenset({"POST", "PATCH"})
NOISE_HEADERS = frozenset(
    {"host", "accept", "accept-encoding", "connection", "user-agent", "content-length"}
)
TEXT_TYPES = ("application/json", "application/problem+json", "application/xml", "text/")


class UapiClient:
    def __init__(self, persona, settings, recorder, transport=None):
        self.persona = persona
        self.settings = settings
        self.recorder = recorder
        self._lock = asyncio.Lock()
        self._open(transport)

    @property
    def mode(self):
        return "live" if self._transport is None else "mock"

    async def use(self, transport):
        await self._http.aclose()
        self._open(transport)

    async def aclose(self):
        await self._http.aclose()

    async def token(self):
        async with self._lock:
            if self._bearer and time.time() < self._expires_at - REFRESH_MARGIN_S:
                return self._bearer
            body = {
                "content": {
                    "type": "API_KEY",
                    "key": self.persona.api_key,
                    "secret": self.persona.api_secret,
                }
            }
            headers = {
                "X-Api-Version": self.settings.uapi_api_version,
                "X-Idempotency-Key": str(uuid.uuid4()),
            }
            response = await self._send("POST", "/tokens", json=body, headers=headers, step="token")
            response.raise_for_status()
            authentication = response.json()["content"]["authentication"]
            self._bearer = authentication["bearer"]
            self._expires_at = datetime.fromisoformat(authentication["expires_at"]).timestamp()
            return self._bearer

    async def request(
        self,
        method,
        path,
        *,
        json=None,
        params=None,
        headers=None,
        step="passthrough",
        idempotency_key=None,
    ):
        args = (method, path, json, params, headers, step, idempotency_key)
        response = await self._authorized(*args)
        if response.status_code == 401:
            self._bearer = None
            response = await self._authorized(*args)
        return response

    def _open(self, transport):
        self._transport = transport
        self._http = httpx.AsyncClient(
            base_url=self.settings.uapi_base_url, transport=transport, timeout=REQUEST_TIMEOUT_S
        )
        self._bearer = None
        self._expires_at = 0.0

    async def _authorized(self, method, path, json, params, headers, step, idempotency_key):
        sent = dict(headers or {})
        sent["Authorization"] = f"Bearer {await self.token()}"
        sent["X-Api-Version"] = self.settings.uapi_api_version
        if method.upper() in IDEMPOTENT_METHODS:
            sent["X-Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
        return await self._send(method, path, json=json, params=params, headers=sent, step=step)

    async def _send(self, method, path, *, json=None, params=None, headers=None, step):
        request = self._http.build_request(method, path, json=json, params=params, headers=headers)
        started = time.perf_counter()
        try:
            response = await self._http.send(request)
        except httpx.HTTPError as exc:
            self._record(step, request, json, started, error=f"{type(exc).__name__}: {exc}")
            raise
        self._record(step, request, json, started, response=response)
        return response

    def _record(self, step, request, body, started, response=None, error=None):
        headers = mask_headers(_headers(request.headers))
        call_response = None
        if response is not None:
            call_response = CallResponse(
                status=response.status_code,
                headers=mask_headers(_headers(response.headers)),
                body=mask_json(_response_body(response)),
            )
        self.recorder.add(
            CallRecord(
                step=step,
                persona=self.persona.name,
                mode=self.mode,
                method=request.method,
                url=str(request.url),
                request=CallRequest(headers=headers, body=mask_json(body)),
                response=call_response,
                duration_ms=round((time.perf_counter() - started) * 1000, 1),
                curl=to_curl(request.method, request.url, headers, mask_json(body)),
                error=error,
                record_id=_record_id(request.url.path, call_response and call_response.body),
            )
        )


def _headers(headers):
    decoded = ((k.decode("latin-1"), v.decode("latin-1")) for k, v in headers.raw)
    return {k: v for k, v in decoded if k.lower() not in NOISE_HEADERS}


def _response_body(response):
    if not response.content:
        return None
    content_type = response.headers.get("content-type", "")
    if not content_type.startswith(TEXT_TYPES):
        return f"<{content_type or 'binary'} {len(response.content)} bytes>"
    try:
        return response.json()
    except ValueError:
        return response.text


def _record_id(path, body):
    parts = path.strip("/").split("/")
    if parts[0] != "records":
        return None
    if len(parts) > 1:
        return parts[1]
    content = body.get("content") if isinstance(body, dict) else None
    return content.get("id") if isinstance(content, dict) else None
