# `backend/fixtures/uapi/` — provenance

Fixtures replayed by `app/mock.py` (`UAPI_MODE=mock`, `httpx.MockTransport`). No credentials, no
recorded live data: every file here is **synthetic**. Recorded TEST responses replace them as soon
as `.env` carries Unit-level TEST keys (`UAPI_RECORD=1`); recorded files must pass through
`app/mask.py` first and keep the `_fixture` stamp.

Bodies are shaped against `spec/fiskaly.uapi.e-invoice-{it,be}.2026-06-01.yaml`
(`components.schemas`: `TokenResource`, `SystemResource`, `RecordResource`, `Record`,
`IntentionRecord`, `TransactionRecord`, `InvoiceTransaction`, `BusinessRecipient`,
`RecipientInvoicing`, `RecordState`, `RecordMode`, `RecordLogs`, `Compliance`, `Content`).

| File                              | Source    | Notes                                                                                                                                                                                                                                             |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST_tokens.json`                | synthetic | `_fixture.source = synthetic`; bearer is `***`                                                                                                                                                                                                    |
| `GET_systems_{id}.json`           | synthetic | `compliance.state = TRANSMISSION_RECEPTION` so reception works                                                                                                                                                                                    |
| `GET_systems.json`                | synthetic | `SystemResources` list wrapping the same system as `GET_systems_{id}.json`; answers `GET /systems?taxpayer_id=…`                                                                                                                                  |
| `GET_taxpayers.json`              | synthetic | `TaxpayerResources` list with one Belgian `COMPANY` taxpayer; no `fiscalization` block (its `credentials` would be a secret)                                                                                                                      |
| `GET_taxpayers_{id}.json`         | synthetic | the same taxpayer as a single `TaxpayerResource`                                                                                                                                                                                                  |
| `artifacts/fatturapa-invoice.xml` | synthetic | FatturaPA `p:FatturaElettronica versione="FPR12"`, `TD01`; served as the compliance artifact for SDI/IT records                                                                                                                                   |
| `artifacts/ubl-invoice.xml`       | synthetic | UBL 2.1 `Invoice`, Peppol BIS Billing 3.0 `CustomizationID urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0`; served for PEPPOL/BE records                                                                              |
| `artifacts/sdi-receipt.xml`       | synthetic | SDI `RicevutaConsegna` (messaggi v1.0); served as the **Receipt of Transmission** (`?archive-artifact`, `content.compliance.archive`) for IT records only. A different document from the compliance artifact above, which carries the invoice XML |

`app/mock.py` builds `INTENTION::TRANSACTION`, `TRANSACTION::INVOICE`, `TRANSACTION::CORRECTION`,
`E_INVOICE::TRANSMISSION` and `E_INVOICE::RECEPTION` records **in code** (deterministic ids
`00000000-0000-4000-8000-<counter>`, deterministic `journal.signed_at`), so there is no JSON fixture
per record; only the XML artifacts above are stored on disk. Before returning them it personalises
the sample XML from the caller's operation so the send → inbox round trip stays coherent:
`document.number` and `totals.vat.inclusive` into the invoice artifact, and `document.number` +
the recipient's SDI `destination_code` into `NomeFile` / `Destinatario/Codice` of the Receipt of
Transmission, so the two artifacts are visibly different documents about the same invoice.

`GET /files/{record_id}.zip` is assembled in memory (`zipfile`, `ZIP_DEFLATED`) and holds
`record.json` (the record envelope), `invoice.xml` (the compliance artifact) and, for IT records,
`receipt-of-transmission.xml` (the archive artifact). `GET /records` honours `limit` (1–100,
default 10) and a base64 offset `token`, and emits `pagination{next, token, limit}` while more
results remain — the shape `components.schemas.Pagination` declares.

Onboarding resources (`/organizations`, `/subjects`, `/taxpayers`, `/locations`, `/systems`) are
likewise built **in code**, synthetic by construction: every list starts **empty** — mirroring a
fresh fiskaly account — and fills as `POST /taxpayers` → `PATCH` (COMMISSION) → `POST /systems` →
`PATCH` (COMMISSION) are replayed (deterministic ids, `state ACQUIRED`/`mode INACTIVE` on create,
`COMMISSIONED`/`OPERATIVE` on commission, `compliance.state TRANSMISSION_RECEPTION`, and an
`annotations.peppol_id` derived from the taxpayer's country and fiscalization numbers when a
PEPPOL registration is present). Credentials inside `fiscalization.credentials` are stored and
echoed as `{type}` only — never the PIN/password. `GET /taxpayers/{id}` and `GET /systems/{id}`
still fall back to the JSON fixtures above for ids that were never created, so the unprovisioned
send flow (`mock-*-system-*` ids) keeps working. One deliberate simplification: commissioning a
BE/DE system yields `mode OPERATIVE` immediately, whereas the real TEST environment answers
`DEGRADED` until the Peppol proof-of-ownership upload completes (the published collections assert
exactly that).

A `TRANSACTION::CORRECTION` is created from
`{"type": "CORRECTION", "record": {"id": <corrected invoice record>}, "reason": ..., "data": {"type": "INVOICE", ...}}`
and 404s when the corrected record does not exist. It advances to its **own**
`E_INVOICE::TRANSMISSION` and its own `E_INVOICE::RECEPTION`, exactly like an invoice.

Licence: synthetic content, same licence as the repository. No third-party material in this
directory (CEN EN 16931 EUPL-1.2 examples and the XSD/XSLT live under the repo-root `vendor/`).
