# Architecture

Condensed from the approved plan (`docs/adr/` records the individual decisions in detail).

## Dual-track design

The fiskaly Unified API (UAPI) accepts a structured JSON `TRANSACTION::INVOICE`, not XML — fiskaly generates the XML server-side (GOBL → Invopop → Peppol/SDI). The tool is therefore dual-track:

- **Client-side e-invoice lab** — generates the XML the user _expects_ from the canonical invoice model, validates it locally, and visualises it (XML ⇄ Human).
- **UAPI harness** — sends the same invoice through fiskaly via the backend proxy, follows its lifecycle, and fetches the XML fiskaly actually transmitted.

The two are diffed against each other: the local prediction vs. `GET /records/{transmission_id}?compliance-artifact`. **The diff is the demo moment.** See [ADR-0001](adr/0001-dual-track-architecture.md).

## Split-screen shell

`main.tsx`, `app.tsx`, `theme.css` render a resizable split (`react-resizable-panels`): `WorkflowPane` on the left drives the workflow, `ApiLogPane` on the right shows the live UAPI HTTP calls each step produces. `--fsk-*` brand tokens are mapped to Tailwind, light and dark.

## Frontend modules (`frontend/src/`, flat)

| Area             | Files                                                                                                                                                                                                                                                             | Responsibility                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell            | `main.tsx`, `app.tsx`, `theme.css`                                                                                                                                                                                                                                | Split shell, theming                                                                                                                                                                                                                                         |
| Domain (pure TS) | `model.ts`, `decimal.ts`, `presets.ts`, `model-rules.ts`, `formats.ts`, `bt-catalog.json`                                                                                                                                                                         | Canonical `Invoice` model (decimal strings, never floats), `FieldId` addressing (`"lines.2.netAmount"`), presets, arithmetic/consistency rules, format-plugin registry                                                                                       |
| Serializers      | `xml-writer.ts`, `ubl-map/write/parse.ts`, `fatturapa-map/write/parse.ts`, `uapi-map.ts`                                                                                                                                                                          | Mapping tables are data (`{field, path, bt\|fpa, label}`); writers call `el(row, value)` so serialisation and tooltips cannot drift                                                                                                                          |
| Mapping presence | `field-presence.ts`, `PresenceStrip.tsx`                                                                                                                                                                                                                          | For the selected field, whether the model, the operation and the chosen syntax each carry it — quoting the reason `UAPI_LOSSY_FIELDS`, `UAPI_PARTIAL_FIELDS` and the fate evidence already declare, so a non-supported field is named rather than guessed at |
| Locate / diff    | `xml-locate.ts`, `xml-diff.ts`                                                                                                                                                                                                                                    | Path index (from the CodeMirror Lezer tree) resolves field↔node both ways; semantic DOM diff by path                                                                                                                                                         |
| Validation       | `validation.ts`, `schematron.worker.ts`, `xsd-client.ts`, `fatturapa-rules.ts`                                                                                                                                                                                    | Pipeline + `Finding` model, see below                                                                                                                                                                                                                        |
| Spec coverage    | `uapi-fields-client.ts`, `uapi-fields.ts`, `CoveragePanel.tsx`                                                                                                                                                                                                    | Reads the field catalogue from the backend, measures the composed JSON against it branch-relatively, and offers each unpopulated field for insertion — refusing any insert that would not validate                                                           |
| Workflow         | `workflow.ts`, `uapi-client.ts`, `store.ts`                                                                                                                                                                                                                       | Steps `setup → mapper → validate → send`, persona `seller\|buyer`, persisted to `localStorage` (never tokens)                                                                                                                                                |
| Views            | `WorkflowPane.tsx`, `Step{Setup,Mapper,Validate,Send}.tsx`, `InvoiceViewer.tsx`, `XmlView.tsx`, `HumanView.tsx`, `Field.tsx`, `DiffView.tsx`, `FindingsPanel.tsx`, `ApiLogPane.tsx`, `ApiCallCard.tsx`, `PersonaSwitch.tsx`, `ModeBadge.tsx`, `PresenceStrip.tsx` | See Visualisation below                                                                                                                                                                                                                                      |
| Build scripts    | `scripts/gen-types.mjs`, `scripts/build-sef.mjs`, `scripts/build-bt-catalog.mjs` (+ `tools/fetch_assets.py` → `vendor/`)                                                                                                                                          | Type generation from `spec/`, SEF compilation, BT catalog build; XSD/XSLT vendoring via `make schemas`                                                                                                                                                       |

## Backend modules (`backend/app/`, flat)

| File                     | Responsibility                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.py`                | App, lifespan (client + recorder), CORS from `CORS_ORIGINS`, routers                                                                                                                                                                                                                                                                        |
| `settings.py`            | `pydantic-settings`; personas `seller`/`buyer`, each with API key/secret + system/taxpayer ids; fails loudly on missing secrets in LIVE mode                                                                                                                                                                                                |
| `uapi.py`                | `UapiClient` per persona on one `httpx.AsyncClient`: token cache keyed by `expires_at` (refresh 60 s early, `asyncio.Lock`), one retry on 401, injects `X-Api-Version`, `X-Idempotency-Key`, `Authorization`; every call passes the recorder. Mock mode = `httpx.MockTransport` on the same client — live and mock share the same code path |
| `mock.py`                | Fixture-driven transport (`backend/fixtures/uapi/*.json`), deterministic ids, small state machine (transaction gains `used_in` on 2nd GET; transmission `FINISHED` on 3rd; `document.number` starting `FAIL-` → `FAILED`)                                                                                                                   |
| `recorder.py`, `mask.py` | Ring buffer of `CallRecord`, SSE with `Last-Event-ID` replay; masks secrets and long base64 payloads; builds the cURL command                                                                                                                                                                                                               |
| `workflow.py`            | Typed choreography: intention → transaction → poll `used_in` → poll transmission → artifact                                                                                                                                                                                                                                                 |
| `spec.py`                | Resolves the active spec through `spec/spec.json` (dropped spec first, per-country fallback second) and parses `components.schemas` once, memoised on file identity                                                                                                                                                                         |
| `validate.py`            | lxml `XMLSchema` for UBL 2.1 Invoice/CreditNote and FatturaPA 1.2.x; `UapiSchemaValidator` compiles `InvoiceTransaction`/`CorrectionTransaction` to Draft 2020-12, keyed on the spec's content rather than on the country                                                                                                                   |
| `fields.py`              | Walks the `InvoiceTransaction` closure into a flat `{i}`-templated pointer catalogue — constraints, conditional required-ness, per-country applicability parsed from the spec's prose, and spec examples with generic base-type placeholders suppressed                                                                                     |
| `routes.py`, `models.py` | Contract below; UAPI bodies are pass-through `dict`s (no model duplication)                                                                                                                                                                                                                                                                 |

## Validation pipeline

| Stage                 | Runs                           | Engine                                                                  | Notes                                                                                               |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Model rules           | browser, sync                  | `model-rules.ts`                                                        | Σ lines = BT-106, breakdown vs. lines, tax = taxable × rate ± 0.01, channel constraints             |
| Well-formed           | browser                        | `DOMParser`                                                             |                                                                                                     |
| XSD                   | proxy `POST /api/validate/xsd` | lxml                                                                    | Chosen over `libxml2-wasm`; `xsd-client.ts` keeps the seam for a WASM swap                          |
| Schematron (UBL)      | browser Web Worker             | SaxonJS 2 + build-time SEF of EN 16931 UBL XSLT and Peppol BIS 3.0 XSLT | Never compile `.sch` at runtime; fallback Saxon-HE Docker sidecar behind `/api/validate/schematron` |
| SDI rules (FatturaPA) | browser                        | `fatturapa-rules.ts`                                                    | Curated 004xx set (00400/00401 Natura↔Aliquota, 00403, 00417, 00419, 00421–00425, 00426/00427)      |
| fiskaly               | after send                     | record `state`, `logs[]`                                                | ERROR/WARNING logs become findings; SDI codes regex-linked to the rule catalog                      |

`Finding = {source, ruleId, severity fatal|error|warning|info, message, xpath?, range?, bt?, fpa?, field?, test?}`.

## Spec fetched at build time

`tools/fetch_spec.py` (stdlib `urllib`/`json`) resolves the spec in two ways. A YAML dropped into `spec/drop/` wins: it is identified **by content** (`info.version` and `info.title` read from the document head, not from the filename), renamed to `fiskaly.unified-api.all.<version>.yaml` and **moved** into `spec/`, so an empty `spec/drop/` is the "consumed" signal. Otherwise the per-country specs are fetched from `products.json` at the latest CalVer for `it`, `be` and `de`, together with the Postman collections. `spec/spec.json` records the active spec, the fallback and a sha256 per file, and cleanup unlinks **only** files the previous manifest listed. Network failure with a cache → loud warning, continue; no cache → error. `make spec` refreshes, `make spec-check` (in `make doctor` and CI) fails on a stale, tampered or un-ingested `spec/`, and `make setup` calls both. Downstream: `openapi-typescript` generates `frontend/src/gen/uapi.d.ts` from whichever spec the manifest names active; backend defaults `UAPI_API_VERSION` from `version.txt`; fixtures are validated against `components.schemas` with `jsonschema`. See [ADR-0002](adr/0002-spec-fetched-at-build-time.md) and [ADR-0006](adr/0006-drop-in-spec-and-field-metadata.md).

## UAPI choreography

**Setup** (read-only, per persona):

1. `GET /systems/{id}` → `state`/`mode`, `compliance.state`, `annotations.peppol_id`, `vat_rates`, `vat_exemptions`.
2. `GET /taxpayers/{id}` → seller party. A missing/`DEGRADED` system shows guidance instead of provisioning.

**Send** (both presets — IT and BE):

1. `POST /records` — `INTENTION` (`operation.type: TRANSACTION`).
2. `POST /records` — `TRANSACTION::INVOICE` (IT: `invoicing SDI`; BE: `invoicing PEPPOL 0208:<buyer KBO>`).
3. Poll `GET /records/{transaction_id}` until `used_in.id` appears.
4. Poll `GET /records/{transmission_id}` until `mode = FINISHED`.
5. `GET /records/{transmission_id}?compliance-artifact` → DiffView.

**Error demos**: recipient without `invoicing`; `0000000` without PEC (sync 4xx); IT recipient without `address.region` (async `FAILED`); wrong `X-Api-Version`; missing idempotency key; bad token.

## Frontend ↔ backend contract

- `GET /api/health`
- `GET /api/config` → `{mode, environment, api_version, spec_source, spec_sha256, spec_origin, spec_ingested_at, personas: {seller: {IT?: {...}, BE?: {...}}, buyer: {...}}}`
- `GET /api/spec/fields?country=IT&operation=INVOICE` → the field catalogue above, `ETag`-keyed on the spec's sha256 (`304` on `If-None-Match`). Deliberately **not** under `/api/uapi/`, which is a catch-all proxy that would forward it upstream
- `PUT /api/mode {mode}`
- `POST /api/invoices {persona, country, operation, idempotency_key?}` → `{intention_id, transaction_id, state, mode, logs}`
- `GET /api/invoices/{transaction_id}/wait?timeout=60`
- `GET /api/records/{id}/artifact?kind=compliance|archive` → `{type, xml}`
- `POST /api/validate/xsd {schema, xml}` → `{valid, findings[]}`
- `ANY /api/uapi/{path}` passthrough (header `X-Persona`, caller may set `X-Idempotency-Key`)
- `GET /api/calls`, `GET /api/events` (SSE events: `call`, `step`, `ping`)

```
CallRecord = {
  id, ts,
  step: token|setup|intention|transaction|poll|artifact|list|passthrough,
  persona, mode, method, url,
  request: {headers, body},
  response: {status, headers, body},
  duration_ms, curl, error?, record_id?
}
```

## Format-plugin seam

v1 ships **FatturaPA** (Italy, SDI) and **Peppol BIS Billing 3.0** (UBL 2.1, Belgium). XRechnung, ZUGFeRD, and Factur-X are out of v1; `formats.ts` keeps a format-plugin registry so a new format plugs into the same canonical model, mapping-table pattern, and validation pipeline without touching the others.

## Verified UAPI facts

- Base URLs `https://test.api.fiskaly.com` / `https://live.api.fiskaly.com`; environment chosen by URL, resources isolated per environment. TEST = "no tax-authority transmission, simulated validation".
- `X-Api-Version` required on every request, accepted only as exactly `2026-06-01`.
- `POST /tokens` (unauthenticated) `{content: {type: "API_KEY", key, secret}}` → `content.authentication.{type: "JWT", bearer, expires_at, issued_at}`, `organization.id`, `subject.id`. No refresh token.
- `X-Idempotency-Key` (UUID v4/v3) required on all POST/PATCH; 24 h cache; `422` on payload mismatch, `409` while in flight; response headers `X-Idempotency-Replayed`, `X-Trace-Identifier`. `X-Scope-Identifier` optional (org id).
- All e-invoicing is `POST /records`: `INTENTION` (`operation.type: TRANSACTION`) → `TRANSACTION` (`record.id` = intention id, `operation.type: INVOICE`).
- `recipients[].type: BUSINESS` with `invoicing` ∈ `PEPPOL{identifier}` | `SDI{destination_code, pec?}` | `EMAIL{email, format ZUGFERD_V2|XRECHNUNG_V3}`.
- Invoice record lifecycle: `state ∈ ACCEPTED|REJECTED|COMPLETED|FAILED`, `mode ∈ PROCESSING|FINISHED`, `logs[]{severity, message}`. The async worker creates an `E_INVOICE::TRANSMISSION` record, visible as `content.used_in.id`. BE completes quickly; IT waits for SDI (minutes, up to 48 h).
- `content.transmission` is **not** populated for e-invoice records — the transmitted XML is only available via `GET /records/{transmission_id}?compliance-artifact` → `content.compliance.artifact{type: "application/xml", data: <base64>}`.
- Reception (v5.2+): inbound documents create `E_INVOICE::RECEPTION` records (`state COMPLETED`); requires the system's `compliance.state = TRANSMISSION_RECEPTION`. No webhooks in the spec — polling only.
- Errors: `{status, code, error, message}` (`E_BAD_REQUEST`, `E_UNAUTHORIZED_ACCESS`, `E_RESOURCE_CONFLICT`, `E_UNPROCESSABLE_CONTENT`, `E_TOO_MANY_REQUESTS`, …). Pagination `?limit&token` → `pagination{next, token, limit}`, max 100.
- CORS: `OPTIONS test.api.fiskaly.com/tokens` returns 404 with no CORS headers — a proxy is required.
