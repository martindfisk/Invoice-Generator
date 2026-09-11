# Demo Script

A scripted showcase for a solutions engineer presenting the e-invoice lifecycle — create → validate → send — to sales, partners, or prospects. Total runtime: ~17 minutes (~15 for Acts 1–3, +2 for Act 4); leave a few minutes of buffer for questions.

## Setup checklist

- [ ] One TEST API key configured — either in `.env` or via the app's Settings dialog, which persists it on the backend across restarts (see `README.md`).
- [ ] `make dev` running; the workflow pane (left) and the API log pane (right) load with no console errors.
- [ ] Status badge reads **MOCK** for a rehearsal or no-network fallback; **LIVE · TEST API** for a live demo (the red **LIVE · PRODUCTION** state should never appear in a demo).
- [ ] Browser window wide enough for the split (≥ 1280 px) — workflow left, API log right; the Mapper itself shows three panes: Human view, fiskaly JSON operation, predicted XML.

## Act 1 — Create (Italian B2B, SDI)

Select preset **"Italian B2B (SDI)"**.

1. Walk the **Mapper's three panes**: the form fields (Human view), the **fiskaly JSON operation** in the middle — the artifact you actually author and Send posts unchanged — and the predicted FatturaPA XML fiskaly will generate from it.
2. Edit in any pane; the other two follow. Point out the spec-coverage line under the JSON: every unpopulated spec field can be inserted.
3. Point out the **BT / FPA badges** on a couple of fields (e.g. the seller VAT number, a line's VAT category) — hover for the tooltip naming the EN 16931 business term and the FatturaPA block it maps to.

**Talking point**: every field on screen traces to a legal business term (EN 16931) and to Italy's FatturaPA block — this is the actual document structure SDI expects under the D.Lgs. 127/2015 e-invoicing mandate, not a generic invoice form.

## Act 2 — Validate

1. Show the validation pipeline running as you edit: model rules first (sync, instant), then well-formedness, XSD, Schematron, and FatturaPA SDI rules.
2. **Break the XML by hand**: use the edit toggle in XML view, remove or corrupt a required element, and let it revalidate.
3. Click the resulting entry in the **Findings panel** — show the highlight jump to both the XML range and the Human-view field.

**Talking point**: the same layered pipeline a production integration would need — structural, schema, and EN 16931 business-rule validation (Schematron, e.g. BR-CO calculation rules) — runs locally (browser plus the local proxy for XSD) before anything is sent, catching errors before they ever reach SDI.

## Act 3 — Send

1. Trigger send. Narrate the two calls as they appear in the log pane: `POST /records` (`INTENTION`), then `POST /records` (`TRANSACTION::INVOICE`).
2. Show the poll calls ticking in the log pane until the `E_INVOICE::TRANSMISSION` record reaches `FINISHED`.
3. Open the fetched **compliance artifact** — the XML fiskaly actually transmitted — in `DiffView` next to the locally generated XML.
4. Toggle normalisation (pretty-print, strip signature, ignore volatile ids/timestamps) to narrow the diff down to only meaningful differences.

**Talking point**: fiskaly builds this XML server-side (GOBL → Invopop → SDI) from the same structured JSON just sent — the diff proves the tool's local prediction matches what a tax authority actually receives.

## Act 4 — Peppol BE preset (2 minutes)

Repeat Acts 1–3 compressed, using preset **"Peppol BE"**: send as `TRANSACTION::INVOICE` with `invoicing PEPPOL 0208:<buyer KBO>`, artifact diff (UBL this time, not FatturaPA).

**Talking point**: same tool, same pipeline, different jurisdiction — Belgium's B2B Peppol mandate takes effect 1 January 2026, and this is the EN 16931-conformant Peppol BIS Billing 3.0 path rather than Italy's SDI path.

## Act 5 — Germany and the credit note (optional, 2 minutes)

1. Preset **"B2G Kommune (XRechnung)"**: the same pipeline, third jurisdiction — XRechnung over Peppol with a Leitweg-ID (`0204:`), Schematron running CEN + KoSIT rules.
2. Preset **"TD04 credit note"** after an invoice was sent: the JSON pane becomes a `TRANSACTION::CORRECTION` referencing the transmitted record, posted via `POST /api/invoices/{id}/correction`. Until an original invoice exists, Send is blocked with the explanation.

## Error demos

Trigger on request, or when a question invites it:

- Recipient without an `invoicing` block — invoice completes with an ERROR log, no transmission.
- SDI destination code `0000000` without a PEC address — synchronous 4xx.
- IT recipient missing `address.region` — asynchronous `FAILED` after SDI processing.
- Wrong `X-Api-Version` header — rejected outright.
- Missing `X-Idempotency-Key` — rejected outright.
- Bad token / expired credentials — `401`, shown in the log pane.

## What the audience should remember

- The tool shows both sides of the e-invoice lifecycle at once: what a client expects to send, and what fiskaly actually transmits — the diff is the demo moment.
- Every field is traceable to its legal basis: EN 16931 business terms, plus the jurisdiction-specific format (FatturaPA for Italy's SDI, Peppol BIS 3.0 for Belgium).
- It is one tool for two audiences: a sales/demo showcase and a working UAPI test harness — the calls in the log pane are real requests a developer would make.
