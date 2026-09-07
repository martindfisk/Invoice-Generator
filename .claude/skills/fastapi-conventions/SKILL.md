---
name: fastapi-conventions
description: Backend conventions for this repo — FastAPI + asyncio + httpx, pydantic-settings, recorder/SSE, mock transport, masking, tests with respx and ASGITransport, ruff. Load before editing anything under backend/.
---

# Backend conventions (`backend/`)

- **Layout**: flat `app/` — `main.py` (app + lifespan), `settings.py`, `uapi.py`, `workflow.py`, `mock.py`, `recorder.py`, `mask.py`, `validate.py`, `routes.py`, `models.py`. Tests in `tests/`, fixtures in `fixtures/uapi/`; XSD/XSLT live in the repo-root `vendor/` (produced by `make schemas`, path from `Settings.vendor_dir` / `VENDOR_DIR`).
- **Runtime**: Python 3.13, venv at `backend/.venv` (`python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`), run `uvicorn app.main:app --reload --port 8000`. `asyncio` only — no `anyio`-specific APIs, no threads for I/O.
- **Settings**: `pydantic-settings` reading the repo-root `.env` (`extra="ignore"`); `personas` (`seller`, `buyer`) with key/secret/system ids; `UAPI_API_VERSION` defaults to `spec/version.txt`; `validate_live()` raises at startup in live mode when credentials are missing.
- **HTTP client**: one `httpx.AsyncClient` per persona created in lifespan; live vs mock = transport (`httpx.MockTransport` from `mock.py`) — no `if mode` in business code. `UapiClient.request()` is the only place headers (`Authorization`, `X-Api-Version`, `X-Idempotency-Key`) are set and the only place calls are recorded.
- **Recorder/SSE**: `deque(maxlen=RECORDER_CAPACITY)`; subscribers are `asyncio.Queue`s; `GET /api/events` is a `StreamingResponse(media_type="text/event-stream")` with `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `id:`/`event:`/`data:` framing, `ping` every 15 s, `Last-Event-ID` replay. Event payload = `CallRecord` (pydantic) serialised with `model_dump_json()`.
- **Masking**: everything recorded passes `mask.py` first; cURL is derived from masked data. Add new secret keys there, nowhere else.
- **Errors**: upstream status + body pass through (`JSONResponse(status_code=r.status_code, content=r.json())`); configuration errors raise; use `HTTPException` only at the API boundary (bad persona, mode refused). No blanket `try/except`.
- **Polling**: `asyncio.sleep(POLL_INTERVAL_S)` loops bounded by `POLL_TIMEOUT_S`; each poll is a recorded call with `step="poll"`.
- **Tests**: `pytest -q` (`asyncio_mode=auto`), `respx` for upstream mocking (assert headers, call counts), `httpx.AsyncClient(transport=ASGITransport(app=app))` for routes, `jsonschema` for fixture-vs-spec contract.
- **Style**: `ruff format` + `ruff check` (E, F, I, UP, B), line length 100, no comments/docstrings, small functions, explicit names.
