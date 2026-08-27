# 0001. Dual-track architecture

## Status

Accepted

## Context

The fiskaly Unified API (UAPI) accepts e-invoices as a structured JSON `TRANSACTION::INVOICE`, not XML. fiskaly generates the transmitted XML server-side (GOBL → Invopop → Peppol/SDI). The tool needs to both make the e-invoice lifecycle tangible visually (XML ⇄ human-readable, per the brief) and act as a UAPI test harness — and those two goals pull toward different data flows. A pure visualisation tool would generate XML locally and never touch the API. A pure API test tool would only ever see JSON requests and recorded responses, with no independently generated "expected" document to compare against.

## Decision

Build both tracks and diff them against each other:

- **Client-side e-invoice lab**: from the canonical invoice model, generate the XML the user *expects* (UBL 2.1 / FatturaPA), validate it locally (model rules, XSD, Schematron, SDI rules), and visualise it XML ⇄ human.
- **UAPI harness**: map the same canonical model to a `TRANSACTION::INVOICE`, send it through the UAPI (`INTENTION` → `TRANSACTION::INVOICE`), follow its lifecycle, and fetch the XML fiskaly actually transmitted via `GET /records/{transmission_id}?compliance-artifact`.

The two XML documents are diffed in `DiffView`, with normalisation toggles for expected differences (pretty-printing, signature blocks, volatile ids/timestamps). This diff is the centrepiece of the demo.

## Alternatives considered

- **XML-only tool, no API.** Simpler: no backend, no credentials to manage. Rejected — cannot demonstrate or test the UAPI itself, which is a stated requirement, and gives no way to show what fiskaly actually produces versus what a client predicts.
- **API-only tool, no local generation.** Send invoices through the UAPI and show only the returned compliance artifact. Rejected — gives no toggleable, explorable "expected" view independent of the API, and the diff itself is impossible without a second, independently generated document to compare against.

## Consequences

- Two independent code paths must stay semantically aligned: the format writers (`ubl-write.ts`, `fatturapa-write.ts`) and the UAPI mapper (`uapi-map.ts`) both derive from the same canonical `Invoice` model, which reduces but does not eliminate drift between them.
- The diff view only becomes available once both the local XML and the compliance artifact exist — send must complete before the demo moment is reached, so both LIVE mode timing (IT can take minutes up to 48 h) and MOCK mode need to support reaching that state.
- Format-plugin effort is doubled per format (a local writer/parser plus a UAPI mapping), which is why v1 is scoped to FatturaPA and Peppol BIS 3.0 only, behind a plugin seam (`formats.ts`) for future formats.
- Golden fixture tests are required to keep the local writers honest independent of the live diff.
