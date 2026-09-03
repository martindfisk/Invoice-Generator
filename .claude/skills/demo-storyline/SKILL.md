---
name: demo-storyline
description: The scripted showcase of the Invoice Generator — personas, presets, the four acts (setup, compose, validate, send), the compliance-artifact diff moment, error demos and per-country talking points. Load when building UI flows, presets, docs or tests that must mirror the demo.
---

# Demo storyline (≈ 10 minutes)

Personas: **Seller** (org A, Unit key) and **Buyer** (org B, Unit key), both in fiskaly TEST with commissioned `E_INVOICE_SERVICE` systems. Presets: **"Italian B2B (SDI)"** — IT seller (taxpayer data from `GET /taxpayers/{id}`), buyer with `destination_code` (`BUYER_SDI_DESTINATION_CODE`), lines at 22 % and 10 %, one N3.x exemption line, TP02 credit transfer with IBAN; **"Peppol BE"** — BE seller, buyer `0208:<KBO>` (`BUYER_PEPPOL_ID`), 21 % standard, purchase-order reference (PEPPOL-EN16931-R003); **"Intentionally broken"** — wrong VAT sum, missing buyer country, exemption without reason, `0000000` without PEC.

| Act | User does | Left pane shows | Right pane shows | Talking point |
|---|---|---|---|---|
| 0 Setup | opens app, picks LIVE/MOCK, persona Seller | systems/taxpayers read, `peppol_id`, compliance state | `POST /tokens`, `GET /systems/{id}`, `GET /taxpayers/{id}` | one API for IT and BE; Unit-scoped tokens; `X-Api-Version` |
| 1 Compose | picks preset, edits a line | Human view with BT/FPA badges → toggles XML → Split | — | one model, two national syntaxes; the XML is the legal instance |
| 2 Validate | runs validation, breaks the XML by hand, re-runs | stage stepper, findings highlight XML + field | `POST /api/validate/xsd` | local checks ≠ acceptance by SDI/Peppol; layered rules (XSD → Schematron/SDI) |
| 3 Send | clicks Send | INTENTION → TRANSACTION::INVOICE → transmission polling → COMPLETED; DiffView local vs compliance artifact | 2× `POST /records`, polls, `?compliance-artifact` | fiskaly generates and transmits; the diff shows what fiskaly added/normalised |
| 4 Peppol BE | repeats 1–3 with the BE preset in 2 minutes | same | same | same integration, different network and format |

Error demos (pick two): recipient without `invoicing` → COMPLETED with ERROR log, nothing sent · `0000000` without PEC → 4xx · IT recipient without `region` → async FAILED · wrong `X-Api-Version` → 400 · replayed idempotency key → `X-Idempotency-Replayed: true`.

Legal context per country: Italy — D.Lgs. 127/2015, SDI, FatturaPA specs 1.9.1, B2B + B2C, 10-year archive; Belgium — B2B Peppol BIS 3.0 mandatory 1 Jan 2026 (law of 6 Feb 2024), BOSA; EU — Directive 2014/55/EU, EN 16931, ViDA digital reporting on the horizon. Close: "one integration, structured data in, compliant XML out, both directions, with full visibility of every API call."
