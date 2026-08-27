---
name: fiskaly-unified-api
description: Facts and call choreography for the fiskaly Unified API (UAPI) e-invoicing product — base URLs, auth, headers, records lifecycle, recipients (PEPPOL/SDI/EMAIL), compliance artifacts, reception, errors. Load whenever code, fixtures or docs touch test.api.fiskaly.com, live.api.fiskaly.com or spec/.
---

# fiskaly Unified API (UAPI) — e-invoicing

Authority order: `spec/fiskaly.uapi.e-invoice-{it,be}.<version>.yaml` (fetched by `tools/fetch_spec.py`) > workspace.fiskaly.com docs > this file > memory. Older bodex/Postman `2026-05-04` bodies are **v4 and stale** (`document.total_vat`, scalar `unit.price`, no `SDI`) — never copy them.

## Environments, versioning, auth
- `https://test.api.fiskaly.com` (no tax-authority transmission, simulated validation, free) / `https://live.api.fiskaly.com`. Environment = base URL; resources are isolated per environment.
- `X-Api-Version` on **every** request; only the exact value in `spec/version.txt` is accepted (`2026-06-01` as of 2026-08-26). CalVer; releases within a version do not bump it.
- `POST /tokens` (unauthenticated, needs `X-Api-Version`): `{"content": {"type": "API_KEY", "key": "...", "secret": "..."}}` → `content.authentication.{type: "JWT", bearer, expires_at, issued_at}`, `content.organization.id`, `content.subject.id`. No refresh token; re-issue before `expires_at`. Keys come from HUB (hub.fiskaly.com), Group- or Unit-level; operational calls use a **Unit-scoped** token.
- `Authorization: Bearer <bearer>` on everything else. `X-Idempotency-Key` (UUID v4) on every POST/PATCH: 24 h cache, `422` payload mismatch, `409` while in flight, response header `X-Idempotency-Replayed`. `X-Scope-Identifier` (org id) optional. Responses echo `X-Api-Version`, `X-Trace-Identifier`.

## Resources
`/subjects`, `/organizations`, `/taxpayers`, `/locations`, `/systems`, `/records`, `/files` — each `GET`/`POST` collection and `GET`/`PATCH /{id}` (`GET /files/{path}` streams). Everything e-invoicing is a **record**.
- Taxpayer `type COMPANY` with `fiscalization{type: IT|BE, vat_id_number, tax_id_number, ...}`; IT needs `address.region` (provincia) and REA `registration`. Seller party data (EN 16931 BG-4) comes from here.
- System `type E_INVOICE_SERVICE`, `location.id` = taxpayer's HEAD_OFFICE, `registrations: [{type: "PEPPOL"|"SDI"}]`; read `state` (`COMMISSIONED`), `mode` (`OPERATIVE|DEGRADED`), `compliance.state` (`TRANSMISSION_ONLY|TRANSMISSION_RECEPTION`), `annotations.peppol_id`, `vat_rates`, `vat_exemptions`.

## Invoice choreography
1. `POST /records` `{"content": {"type": "INTENTION", "system": {"id": "<system_id>"}, "operation": {"type": "TRANSACTION"}}}` → `intention_id`.
2. `POST /records` `{"content": {"type": "TRANSACTION", "record": {"id": "<intention_id>"}, "operation": {"type": "INVOICE", "document": {...}, "entries": [...], "recipients": [{"type": "BUSINESS", ..., "invoicing": {...}}], "payments": [...], "breakdown": [...], "totals": {"vat": {"amount", "exclusive", "inclusive"}}}}}` → record `TRANSACTION::INVOICE` with `state`, `mode`, `logs`. Required: `document, entries, recipients, payments, breakdown, totals`. Shapes (`InvoiceTransaction`, `Entries`, `EntryVat`, `VatBreakdown`, `BusinessRecipient`, `RecipientInvoicing`) — always confirm in `spec/…yaml` `components.schemas`.
3. `recipients[].invoicing`: `{"type": "PEPPOL", "identifier": "0208:0123456789"}` (regex `^[0-9]{4}:[a-zA-Z0-9._/, -]{1,59}$`) · `{"type": "SDI", "destination_code": "ABCDEFG", "pec": "x@pec.it"}` (`^[A-Z0-9]{7}$`; `0000000` = no SDI inbox → `pec` required; `XXXXXXX` = foreign buyer) · `{"type": "EMAIL", "email", "format": "ZUGFERD_V2"|"XRECHNUNG_V3"}`.
4. Poll `GET /records/{transaction_id}` until `content.used_in.id` exists → that is the `E_INVOICE::TRANSMISSION` record. No `used_in` but `logs[]` with severity `ERROR` (e.g. "no recipient with invoicing configuration found") = nothing transmitted.
5. Poll `GET /records/{transmission_id}` until `mode = FINISHED`; `state` ∈ `COMPLETED|FAILED`; `logs[]` carries provider/SDI messages (e.g. `00471 Cessionario uguale al cedente`). BE finishes in seconds; IT waits for SDI (minutes; spec allows 48 h).
6. `GET /records/{transmission_id}?compliance-artifact` → `content.compliance.artifact{type: "application/xml", data: <base64 XML>}` — the XML fiskaly transmitted (IT: SDI-validated FatturaPA; BE: UBL). **`?archive-artifact` is the Receipt of Transmission** (the SDI *ricevuta di consegna* — a different document from the invoice XML, naming the transmitted file and the destination code). Also `?operation`, and `GET /files/{record_id}.zip` bundling `record.json` + `invoice.xml` + `receipt-of-transmission.xml`. **`content.transmission` is not populated for e-invoice records.**
7. Lists: `GET /records?type=TRANSACTION::INVOICE,E_INVOICE::TRANSMISSION&system_id=…&limit=…&token=…` → `results[]`, `pagination{next, token, limit}` (max 100).
8. Reception: inbound documents create `E_INVOICE::RECEPTION` records (`state COMPLETED`, id = provider entry id); `GET /records?type=E_INVOICE::RECEPTION&system_id=…` newest first; `?compliance-artifact` original XML, `?operation` structured JSON. Needs `compliance.state = TRANSMISSION_RECEPTION`. No webhooks in the spec → poll.

## Corrections and credit notes

A credit note is **not** sent as another `INVOICE` — it is a `CORRECTION` that references the record it corrects, and it opens its own intention and gets its own transmission:

```json
{"content": {"type": "TRANSACTION", "record": {"id": "<a NEW intention>"},
  "operation": {"type": "CORRECTION", "record": {"id": "<the ORIGINAL invoice record>"},
    "reason": "...", "data": {"type": "INVOICE", "...": "the full corrected invoice"}}}}
```

Sending it as a plain `INVOICE` would create a second invoice rather than correct the first. `data` is byte-identical in shape to the invoice `operation`, so the same mapping is reused.

## Recipient shapes worth knowing

`BUSINESS` uses `identification: {type: "VAT"|"TAX"|"OTHER", number}` — the number is the **bare national number** (`03456789012`), not country-prefixed; the country lives in `address.country`. `CONSUMER` (Italian B2C) uses `name: {forename, surname, gender}` with `identification: {type: "TAX", number: <codice fiscale>}` and `invoicing: {type: "SDI", destination_code: "0000000", pec}`. `address.line` has exactly one shape, `STREET_NUMBER`, and **both `street` and `number` are required** — a house number embedded in the street line is spec-invalid.

## Lifecycle enums and errors
`state ACCEPTED|REJECTED|COMPLETED|FAILED`, `mode PROCESSING|FINISHED`, `logs[]{severity, message}`. HTTP errors are **wrapped**: `{"content": {"status", "code", "error", "message"}}` (verified against `components.responses.*Response` in the spec — the docs site shows the inner object only). Codes: `E_BAD_REQUEST`, `E_UNAUTHORIZED_ACCESS`, `E_RESOURCE_CONFLICT`, `E_METHOD_NOT_ALLOWED`, `E_UNPROCESSABLE_CONTENT`, `E_TOO_MANY_REQUESTS`. Wrong `X-Api-Version` → 400 `unsupported 'X-Api-Version'`; missing idempotency key → 400.

## Demo error cases
Recipient without `invoicing` (COMPLETED + ERROR log, no transmission) · SDI `0000000` without `pec` (sync 4xx) · IT recipient without `address.region` (async FAILED) · wrong `X-Api-Version` · missing `X-Idempotency-Key` · bad token (401).

## References
`references/choreography.md` (request bodies as cURL, kept in sync with `backend/app/workflow.py`), `references/open-questions.md`. Sources: `spec/SOURCES.md`; workspace.fiskaly.com `/e-invoice/2026-06-01/{integration-guide,italy,belgium,country-coverage}`, `/e-invoice/faq`, `/reference/base-urls`, `/blog/unified-api-idempotency-transparency`; fiskaly internals `/Users/martin.dutzler/Documents/GitHub/meta/doc/unified/e-invoice/`, hurl e2e `meta/etc/test/unified/v5/`.
