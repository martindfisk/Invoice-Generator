import asyncio
import time
import uuid
from datetime import datetime

import httpx

from app.mask import mask_headers, mask_json, to_curl
from app.recorder import CallRecord, CallRequest, CallResponse
from app.workflow import UpstreamError

REFRESH_MARGIN_S = 60
REQUEST_TIMEOUT_S = 30.0
IDEMPOTENT_METHODS = frozenset({"POST", "PATCH"})
NOISE_HEADERS = frozenset(
    {"host", "accept", "accept-encoding", "connection", "user-agent", "content-length"}
)
TEXT_TYPES = ("application/json", "application/problem+json", "application/xml", "text/")


class MissingCredentials(RuntimeError):
    pass


class UapiClient:
    def __init__(self, store, recorder, transport=None):
        self.store = store
        self.recorder = recorder
        self._lock = asyncio.Lock()
        self._retired = []
        self._open(transport)

    @property
    def settings(self):
        return self.store.settings

    @property
    def account(self):
        return self.store.account()

    @property
    def mode(self):
        return "live" if self._transport is None else "mock"

    async def use(self, transport):
        # The old client is retired, not closed: a mode switch or settings save must not tear
        # down the connection pool a poll loop is mid-request on. Retired clients are closed at
        # shutdown; the list is bounded by the number of settings changes in the process's life.
        self._retired.append(self._http)
        self._open(transport)

    async def sync(self):
        async with self._lock:
            await self._sync()

    async def aclose(self):
        await self._http.aclose()
        for client in self._retired:
            await client.aclose()
        self._retired.clear()

    async def token(self):
        async with self._lock:
            await self._sync()
            account = self.account
            if self.mode == "live" and account.missing_credentials:
                raise MissingCredentials(
                    f"no API credentials configured: set them in the settings dialog or "
                    f"{', '.join(account.missing_credentials)} in .env"
                )
            if self._bearer and time.time() < self._expires_at - REFRESH_MARGIN_S:
                return self._bearer
            body = {
                "content": {
                    "type": "API_KEY",
                    "key": account.api_key,
                    "secret": account.api_secret,
                }
            }
            headers = {
                "X-Api-Version": self.store.api_version,
                "X-Idempotency-Key": str(uuid.uuid4()),
            }
            response = await self._send("POST", "/tokens", json=body, headers=headers, step="token")
            if response.status_code >= 400:
                error = UpstreamError(response)
                error.body = {
                    "detail": f"fiskaly rejected the API credentials "
                    f"(POST /tokens returned {response.status_code})",
                    "upstream": error.body,
                }
                raise error
            authentication = response.json()["content"]["authentication"]
            self._bearer = authentication["bearer"]
            self._expires_at = datetime.fromisoformat(authentication["expires_at"]).timestamp()
            # Taken over into the persisted settings: a restart reuses the token until it
            # expires or the credentials/environment change.
            if self.mode == "live":
                self.store.set_token(self._bearer, self._expires_at)
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
        step_name=None,
        run_id=None,
    ):
        # Resolved here, not in _authorized: the 401 retry replays the same args, and a retry
        # that minted a fresh key would no longer be idempotent upstream.
        if method.upper() in IDEMPOTENT_METHODS:
            idempotency_key = idempotency_key or str(uuid.uuid4())
        args = (method, path, json, params, headers, step, idempotency_key, step_name, run_id)
        response = await self._authorized(*args)
        if response.status_code == 401:
            self._bearer = None
            self.store.clear_token()
            response = await self._authorized(*args)
        return response

    def _open(self, transport):
        self._transport = transport
        self._http = httpx.AsyncClient(
            base_url=self.store.base_url, transport=transport, timeout=REQUEST_TIMEOUT_S
        )
        self._bearer, self._expires_at = self.store.token()
        self._revision = self.store.revision()

    async def _sync(self):
        if self._revision != self.store.revision():
            await self.use(self._transport)

    async def _authorized(
        self, method, path, json, params, headers, step, idempotency_key, step_name, run_id
    ):
        sent = dict(headers or {})
        sent["Authorization"] = f"Bearer {await self.token()}"
        sent["X-Api-Version"] = self.store.api_version
        if method.upper() in IDEMPOTENT_METHODS:
            sent["X-Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
        return await self._send(
            method,
            path,
            json=json,
            params=params,
            headers=sent,
            step=step,
            step_name=step_name,
            run_id=run_id,
        )

    async def _send(
        self,
        method,
        path,
        *,
        json=None,
        params=None,
        headers=None,
        step,
        step_name=None,
        run_id=None,
    ):
        request = self._http.build_request(method, path, json=json, params=params, headers=headers)
        started = time.perf_counter()
        try:
            response = await self._http.send(request)
        except httpx.HTTPError as exc:
            self._record(
                step,
                request,
                json,
                started,
                error=f"{type(exc).__name__}: {exc}",
                step_name=step_name,
                run_id=run_id,
            )
            raise
        self._record(
            step, request, json, started, response=response, step_name=step_name, run_id=run_id
        )
        return response

    def _record(
        self, step, request, body, started, response=None, error=None, step_name=None, run_id=None
    ):
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
                mode=self.mode,
                method=request.method,
                url=str(request.url),
                request=CallRequest(headers=headers, body=mask_json(body)),
                response=call_response,
                duration_ms=round((time.perf_counter() - started) * 1000, 1),
                curl=to_curl(request.method, request.url, headers, mask_json(body)),
                error=error,
                record_id=_record_id(request.url.path, call_response and call_response.body),
                run_id=run_id,
                step_name=step_name,
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
