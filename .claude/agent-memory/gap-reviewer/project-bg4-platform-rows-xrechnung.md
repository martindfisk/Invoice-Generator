---
name: project-bg4-platform-rows-xrechnung
description: xrechnung seller.* json rows (BG-4) — severity should-fix confirmed 2026-09-07; verification recipe for CIUS model cardinality + DE taxpayer platform sourcing
metadata:
  type: project
---

The five `xrechnung|seller.{name,tradeName,vatId,legalRegId,legalRegScheme}|json` rows: severity `should-fix` confirmed. Reviewer claim "Platform-rendered mandatory terms; should-fix stands" verified 2026-09-07.

**Verification recipe (reusable for peppol/ubl twin rows):**

- `xrechnung-cius-model.xml` (369 KB, exists in the 3.0.2 bundle): cardinality lives in the _structure_ tree (~line 3258 for the Invoice BG-4 block), NOT in the `<m:term id=...>` dictionary (~line 608). Convention: absence of `min-occurs` = required 1..1; optional terms explicitly carry `min-occurs="0"`. Verified: BG-4, BT-27, BT-34, BG-5 (BT-37/38/40), BG-6 (BT-41/42/43) required; BT-28/29/30/31/32/33 `min-occurs="0"`.
- Active spec `CompanyTaxpayer` (line ~3284) requires `name{legal,trade}` + `address` → platform source for BT-27/BT-28/BG-5. `GermanCompanyFiscalization` (line ~3431) `required: [type]` only; optional `vat_id_number`/`tax_id_number` are annotated in spec prose as "(BT-31 Seller VAT identifier)" / "(BT-32 ...)" for DE_EI — direct spec-level proof of platform sourcing, no web needed.
- BR-DE-16 (model line ~3043): when VAT codes S/Z/E/AE/K/G/L/M are used, at least one of BT-31/BT-32/BG-11 required — conditional, satisfiable from the taxpayer's `vat_id_number`.
- Caveat that does NOT flip severity: `GermanCompanyFiscalization` has **no legal-registration (Handelsregister) field**, so BT-30/legalRegScheme are not platform-renderable at all — but BT-30 is min-occurs 0 and BR-CO-26 is satisfiable via BT-31, so should-fix still holds.

**Why:** severity `blocking` = mandatory term the mandated syntax cannot render; here the syntax renders all five and the platform supplies the mandatory ones, so should-fix is the right rung (see [[project-bt72-bric11-nuance]] — this report's ladder is {should-fix, note} in practice).

**How to apply:** for any BG-4/BG-7 "comes from the taxpayer resource" row, check (1) CIUS/EN cardinality in the structure tree, (2) whether the Taxpayer schema carries a source field for the BT, (3) conditional national rules (BR-DE-16 etc.) before considering blocking.
