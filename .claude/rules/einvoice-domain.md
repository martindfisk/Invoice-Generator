---
paths:
  - "frontend/src/model.ts"
  - "frontend/src/decimal.ts"
  - "frontend/src/presets.ts"
  - "frontend/src/model-rules.ts"
  - "frontend/src/formats.ts"
  - "frontend/src/xml-writer.ts"
  - "frontend/src/*-map.ts"
  - "frontend/src/*-write.ts"
  - "frontend/src/*-parse.ts"
  - "frontend/src/fatturapa-rules.ts"
---

# E-invoice domain rules

- Pure TypeScript: no React, DOM-free except `DOMParser`/`document.evaluate` in `*-parse.ts`. Must run in Vitest under Node without a browser.
- Mapping tables (`ubl-map.ts`, `fatturapa-map.ts`, `uapi-map.ts`) are data rows `{field, path, bt|fpa, label}`; writers emit elements only through a mapping row so tooltips, cross-highlighting and serialisation cannot drift.
- UBL element order follows the UBL 2.1 XSD; FatturaPA follows the FatturaOrdinaria 1.2.x XSD. When unsure, check the XSD in `vendor/` — do not guess order.
- Every change to a writer or mapping needs a golden test (`tests/golden/*.xml`) and must keep the serialise → parse → deep-equal round trip green.
- Code lists (VAT categories, Natura N1–N7, TD, RF, MP, EAS schemes) live in one place per format with the standard's version noted; cite the spec version in the row's `label` source when adding entries.
- Amounts: decimal strings via `decimal.ts`; round half-up to 2 decimals at the boundary the format requires (UBL 2, FatturaPA 2 for amounts, up to 8 for unit prices).
- Legal/spec references in identifiers or labels must name the version (FatturaPA 1.9/1.9.1, Peppol BIS Billing 3.0 release, EN 16931-1:2017/2026).
