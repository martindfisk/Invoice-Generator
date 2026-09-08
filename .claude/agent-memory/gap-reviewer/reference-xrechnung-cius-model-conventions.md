---
name: xrechnung-cius-model-conventions
description: How to read cardinality in xrechnung-cius-model.xml (semo-xml) — absent min-occurs means required; key section line numbers
metadata:
  type: reference
---

`/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Germany/xrechnung-3.0.2-bundle-2026-01-31/xrechnung-3.0.2-xrechnung-model-2026-01-31/model/xrechnung-cius-model.xml` (semo-xml namespace `http://semo-xml.org/2025/model`):

- Term definitions (`<m:term id="BT-nnn">`) carry no cardinality; cardinality lives in `<m:structures><m:structure id="invoice">` (starts line ~3216). Inside a group, `<m:term ref="..."/>` **without** `min-occurs="0"` is required (1..1) — verified against EN 16931: BT-109/112/115 bare vs BT-108/110/111/113/114 `min-occurs="0"`; in BG-25, BT-126/129/130/131 bare vs BT-127/128/132/133 optional. Canary at header level: BT-10 (buyer reference, the famous XRechnung tightening) is bare while BT-11..BT-20 carry `min-occurs="0"` — BT-14 line 3239, BT-18 line 3243 (both optional; verified 2026-09-07, no BR-DE rule touches either).
- BR-* rules restated as `<m:rule id="BR-nn" on-terms="...">` around lines 2270–2320 (BR-21 = every line needs BT-126, line ~2292).
- Syntax bindings: UBL Invoice xpaths from ~line 3600 (header terms) / ~4121 (`BT-126 → /Invoice/cac:InvoiceLine/cbc:ID`), CreditNote ~4445, CII ~5300. Bindings carry **only xpaths, never cardinality** — do not look for min-occurs overrides there.
- Corroborate optionality against `vendor/schematron/XRechnung-UBL-validation.xsl` (the actual 3.0.x BR-DE artefact, vendored): grep the UBL element name; zero hits = no BR-DE presence rule. E.g. SalesOrderID (BT-14) and DocumentTypeCode='130' (BT-18) have zero hits; CEN's only SalesOrderID rule is UBL-CR-651 (warning against @schemeID, not presence).
- XRechnung IS a CIUS of EN 16931, so EN cardinality binds directly (unlike FatturaPA, see [[gap-report-severity-taxonomy]]).

Related contract fact: UAPI `EntryNumber` (`spec/fiskaly.unified-api.all.2026-06-01.yaml`) is optional and its description documents the fallback — "print order defaults to the sequence of the array index, starting at one (1)" — grounding "generator-assigned line id" claims without needing a transmission capture.
