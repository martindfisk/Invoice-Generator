---
name: project-bt72-bric11-nuance
description: BT-72 gap rows (ubl/xrechnung delivery.date) — both severity rows confirmed should-fix; BR-IC-11 falsifies "no assert requires BT-72" citations
metadata:
  type: project
---

Citations claiming "CEN-EN16931-UBL.sch contains no assert requiring BT-72's presence" are false as stated: line 112 carries BR-IC-11 (flag=fatal) — for VAT category K (intra-community supply), BT-72 _or_ BG-14 shall not be blank. Conditional and disjunctive, but it exists.

**Why:** Reviewed `ubl|delivery.date|json` on 2026-09-07 — refuted the citation while confirming the severity (should-fix). Materially: the active UAPI spec (2026-06-01) has **no BG-14/invoicing-period field**, and `Shipping` requires `address` (spec lines ~8247-8259; `date` = BT-72 for BE_EI/DE_EI/IT_EI). So a K invoice composed via the JSON can only satisfy BR-IC-11 by supplying shipping.address+date. PEPPOL-EN16931-UBL.sch has only a date-format rule for ActualDeliveryDate (line ~1133), no presence rule. EN16931_BT_BG_Reference.md line 97: BT-72 = 0..1.

**How to apply:** Generally: verify negative-existence citations by grepping both the BT id _and_ the UBL element name (e.g. `ActualDeliveryDate`), since CEN assert texts sometimes reference a BT only in prose. Also: this gap-report's severity ladder is `{should-fix, note}` only; `blocking` is defined but unused.

**Update 2026-09-07 (same day):** The twin row `xrechnung|delivery.date|json` severity-correct claim ("Optional term; should-fix stands") was **confirmed**. Its citation was positive, not negative-existence: XRechnung 3.0.2 CIUS model `xrechnung-cius-model.xml` lines 3322/3325 carry `<m:group ref="BG-13" min-occurs="0">` / `<m:term ref="BT-72" min-occurs="0"/>` verbatim inside `<m:structure id="invoice">` — so "optional term" is true at cardinality level and does not deny BR-IC-11. R2 trigger verified in `frontend/src/uapi-map.ts` (~742: `UAPI_PARTIAL_FIELDS` lists `delivery.date` with the row's exact reason; ~434: `shipping()` returns undefined without an address). XRechnung's BR-DE-TMP-32 (`XRechnung-UBL-validation.xsl:1265`) is only a "sollte" warning with BG-14/BG-26 alternatives — no escalation past should-fix. Not R3 note: R3 is for optional terms with _no mapping row_ (the cii/fatturapa delivery.date siblings, correctly notes); here xml is mapped and authored data can be lost, R2's first clause exactly.
