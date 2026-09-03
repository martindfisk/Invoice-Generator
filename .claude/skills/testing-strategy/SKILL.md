---
name: testing-strategy
description: Test pyramid, commands, fixture policy and gating for the Invoice Generator (Vitest goldens and Schematron unit fixtures, pytest/respx, Playwright in MOCK mode, gated live smoke). Load when writing tests or CI.
---

# Testing strategy

| Layer | Tool | What | Command |
|---|---|---|---|
| Domain | Vitest | golden XML per preset (`tests/golden/`), serialise → parse → deep-equal, `decimal`, `model-rules`, `fatturapa-rules`, `uapi-map` snapshot vs generated types | `cd frontend && npm test` |
| Validation | Vitest + saxon-js (Node) | goldens → zero fatal; `BR-*.xml` unit fixtures → exactly their rule; SVRL path normaliser | same |
| Frontend units | Vitest + Testing Library | store reducers, api-log parsing, findings → decorations, viewer toggle | same |
| Backend | pytest + respx + ASGITransport | token cache/401 retry/idempotency, masking, recorder replay, choreography (happy · no-invoicing log · FAILED · timeout), passthrough, mock state machine, XSD, fixture-vs-spec `jsonschema` | `cd backend && .venv/bin/pytest -q` |
| E2E | Playwright (chromium) against MOCK | IT happy path through DiffView · BE happy path · broken preset shows findings + highlights · cURL copy | `make e2e` |
| Live smoke | pytest, gated `UAPI_SMOKE=1` | read-only: token, `GET /systems/{id}`, `GET /records?limit=1` | manual |

Rules: deterministic (fixed clock, seeded ids, no network except smoke); assert user-visible behaviour or contracts; never loosen an assertion to pass; unit suites < 10 s, e2e < 2 min; every fixture has provenance (`SOURCES.md` / `_fixture`), recorded UAPI fixtures are masked; CI runs lint + unit + e2e (MOCK) on push, never with live credentials.
