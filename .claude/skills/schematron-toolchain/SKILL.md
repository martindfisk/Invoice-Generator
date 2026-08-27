---
name: schematron-toolchain
description: How this project runs XSD and Schematron validation — compiling official EN 16931 / Peppol XSLT to SaxonJS SEF at build time, running SaxonJS in a Web Worker, parsing SVRL into findings, lxml XSD in the backend, pinning rule-set versions, adding a rule set. Load for any validation-pipeline work.
---

# Validation toolchain

## Stages and where they run
1. Model rules (`frontend/src/model-rules.ts`) — synchronous, on the canonical model.
2. Well-formedness — `new DOMParser().parseFromString(xml, "application/xml")`; a `parsererror` element means fatal.
3. XSD — backend `POST /api/validate/xsd {schema: "ubl-invoice-2.1" | "ubl-creditnote-2.1" | "fatturapa-1.2", xml}` using `lxml.etree.XMLSchema`. Keep the XSD directory layout intact (UBL `maindoc/` imports `common/`; FatturaPA imports `xmldsig-core-schema.xsd`). Error log entries expose `line`, `column`, `message`, `path`.
4. Schematron (UBL only) — SaxonJS 2 in `schematron.worker.ts` executing `public/sef/{en16931-ubl,peppol-ubl}.sef.json`.
5. FatturaPA SDI checks — `fatturapa-rules.ts` (no official Schematron exists for FatturaPA).
6. fiskaly `logs[]` after send → findings with `source: "fiskaly"`.

## Building SEF (never compile `.sch` at runtime)
- Sources: CEN ships a **precompiled** `ubl/xslt/EN16931-UBL-validation.xslt` (release 1.3.15, `github.com/ConnectingEurope/eInvoicing-EN16931`; byte-identical local copy under `/Users/martin.dutzler/Documents/GitHub/bodex/countries/e-invoicing (all countries)/EN16931 standard/ubl/xslt/`).
- **`OpenPEPPOL/peppol-bis-invoice-3` ships `rules/sch/` only — there is no `rules/xslt/` in any tag or anywhere in its history, and `v3.0.20` publishes no release assets.** So `PEPPOL-EN16931-UBL.sch` and `CEN-EN16931-UBL.sch` are compiled `.sch → XSLT` at build time using the official ISO Schematron skeleton (`Schematron/schematron`, MIT, pinned commit, vendored into `vendor/schematron/`). Rejected alternative: `phax/phive-rules` precompiled XSLT — a third-party compilation whose per-release folders contain only *changed* files, which makes version pinning fragile.
- Note the two CEN copies differ: the `CEN-EN16931-UBL.sch` inside BIS 3.0.20 carries the same 1.3.15 header but a **newer ISO 6523 ICD / CEF EAS code list (adds `0245`)**, a real difference in `BR-CL-10/11/21/25/26`. That is why `cen-ubl` and `en16931-ubl` are separate SEFs.
- `tools/fetch_assets.py` (`make schemas`, stdlib Python) vendors pinned versions into the repo-root `vendor/` (git-ignored) and writes `vendor/SOURCES.md`; both lxml (XSD) and the SEF build read from there.
- `frontend/scripts/build-sef.mjs` runs `npx xslt3 -xsl:<xslt> -export:public/sef/<name>.sef.json -nogo -relocate:on` per rule set (the free SaxonJS Node compiler; no Saxon-EE licence). Commit the SEF; record rule-set version + saxon-js version in `public/sef/SOURCES.md`. SEF is tied to the SaxonJS major version — rebuild after upgrading `saxon-js`.
- Bundle: `saxon-js` ≈ 1 MB gzipped, SEF 1–3 MB each → `import("saxon-js")` and `fetch` the SEF lazily on first Schematron run; the stage shows "pending" until loaded.

## Running and parsing
```ts
const result = await SaxonJS.transform({ stylesheetLocation: "/sef/peppol-ubl.sef.json", sourceText: xml, destination: "serialized" }, "async");
```
Parse the SVRL (`http://purl.oclc.org/dsdl/svrl`): each `svrl:failed-assert` / `svrl:successful-report` → `Finding{ruleId: @id, severity: @flag ("fatal"|"warning") else "error", message: svrl:text, xpath: @location, test: @test}`. `@location` uses Saxon's `*:Invoice[namespace-uri()='…'][1]/…` form — normalise to `/Invoice[1]/cac:InvoiceLine[2]/cbc:ID[1]` with the project prefix map before looking it up in `xml-locate.ts`. CEN and Peppol rule ids (`BR-CO-15`, `PEPPOL-EN16931-R003`) are shown verbatim with a link to the rule text.

## Testing
- Node: same SEF via `saxon-js` (`stylesheetFileName`), used by Vitest: goldens → zero fatal; official unit fixtures (`EN16931 standard/test/Invoice-unit-UBL/BR-*.xml`) → exactly their rule id fails.
- Python: `lxml` XSD tests on a valid and a deliberately broken sample per schema.

## Adding a rule set
fetch-assets entry → build-sef entry → register the stage in `validation.ts` (name, applicable formats, SEF path) → prefix map if new namespaces → fixture tests → `SOURCES.md` version line → ADR only if licence/engine changes.

## Fallbacks
If SaxonJS cannot run a stylesheet: Saxon-HE (Java) in a Docker sidecar behind `POST /api/validate/schematron`; if `libxml2-wasm` matures, XSD can move client-side behind `xsd-client.ts`.

Licence notes: SaxonJS is free to use but proprietary (Saxonica); CEN artefacts EUPL-1.2; Peppol rules OpenPeppol licence (redistributable with attribution); UBL XSD OASIS.
