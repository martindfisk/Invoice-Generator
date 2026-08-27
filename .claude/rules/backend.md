---
paths:
  - "backend/**"
---

# Backend rules

- Python 3.13, FastAPI, `asyncio` only (no anyio-specific APIs). Flat `backend/app/` — one file per concern.
- Dependencies are fixed in `pyproject.toml`; before adding one, state what it does and why the standard library cannot.
- Every upstream call goes through `UapiClient.request` so it is recorded, masked and carries `X-Api-Version` + `X-Idempotency-Key`. Never call `httpx` directly from routes.
- Secrets come from `Settings` (`.env`) only; they never appear in logs, fixtures, SSE events or responses. Masking rules live in `mask.py` — extend them there.
- Live and mock share the same code path: mock is an `httpx` transport, not an `if mode == "mock"` branch in business logic.
- Fail loudly at boundaries (missing credentials in live mode, unknown persona, upstream 4xx/5xx passed through with body); no try/except around internal logic.
- UAPI request/response bodies are pass-through dicts; do not duplicate UAPI schemas as pydantic models.
- Tests: pytest + respx for upstream, `httpx.ASGITransport` for routes; live smoke tests are read-only and gated by `UAPI_SMOKE=1`.
- No comments or docstrings in code; the file name and function name carry the meaning.
