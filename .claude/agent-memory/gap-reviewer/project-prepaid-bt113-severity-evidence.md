---
name: prepaid-bt113-severity-evidence
description: BT-113 (totals.prepaid) is 0..1 everywhere; evidence chain for severity-correct on the four totals.prepaid rows
metadata:
  type: project
---

BT-113 "Paid amount" is optional in every relevant ruleset — severity `should-fix` (not `blocking`) is correct for the lossy-JSON rows; xrechnung row confirmed 2026-09-07; cii rows (all four BG-22 adjustments BT-107/108/113/114) confirmed 2026-09-07.

Evidence chain:

- CII binding: `vendor/schematron/EN16931-CII-validation.xslt` — BR-CO-13 analog (lines 687-689) and BR-CO-16 analog (lines 702-704) are disjunctive over absent Allowance/Charge/Prepaid/Rounding TotalAmount; BR-CO-11/12 analogs (657-674) require BT-107/108 only when BG-20/21 exist. `frontend/src/cii-map.ts` lines 380-420 render all four (`ChargeTotalAmount`, `AllowanceTotalAmount`, `RoundingAmount`, `TotalPrepaidAmount`) → R2 "syntax renders it but operation cannot carry it" fits exactly.
- Spec side of "uncarriable": `Totals` schema in `spec/fiskaly.unified-api.all.2026-06-01.yaml` is `{vat}` and `TotalsVat` is `{amount, exclusive, inclusive}`, both `additionalProperties: false` — no property can hold BT-107/108/113/114. Verbatim lossy reason at `frontend/src/uapi-map.ts` lines 644-650.

- XRechnung 3.0.2 CIUS model: `<m:term ref="BT-113" min-occurs="0"/>` at line 3385 inside `<m:group ref="BG-22">` of the single `<m:structure id="invoice">` (lines 3217-3456), which all three syntax bindings (ubl-inv, ubl-cn, cii) reference. File: `/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Germany/xrechnung-3.0.2-bundle-2026-01-31/xrechnung-3.0.2-xrechnung-model-2026-01-31/model/xrechnung-cius-model.xml` (term def line 1459).
- CEN BR-CO-16 (`vendor/schematron/CEN-EN16931-UBL.sch` line 69) explicitly branches on `not(exists(cbc:PrepaidAmount))` — absence legal; BR-DEC-16 (line 75) only fires when present.
- XRechnung BR-DEX-09 (`vendor/schematron/XRechnung-UBL-validation.xsl` line 1996) substitutes 0 for absent PrepaidAmount.
- PEPPOL-EN16931-UBL.sch mentions PrepaidAmount only in decimal/currency contexts, no presence mandate — covers the ubl sibling row too.

**Why:** the claim "Optional term; should-fix stands" recurs per format; same evidence settles ubl and cii siblings (cii binding uses the same structure). fatturapa sibling is `note` (mapping-table absence, different reason — do not reuse this chain for its reason-true).

fatturapa|totals.rounding|json (BT-114) confirmed should-fix 2026-09-07 — differs from fatturapa prepaid because fatturapa-map.ts DOES render rounding: line 379-383 maps `totals.rounding` → `${GENERAL}/Arrotondamento`. XSD `Schema_VFPR12_v1.2.3.xsd`: document-level `Arrotondamento` minOccurs="0" at line 125 inside `DatiGeneraliDocumentoType` (BT-114 analog, 2.1.1.10); a second per-riepilogo `Arrotondamento` at line 1049 in `DatiRiepilogoType` is NOT BT-114. Optional in FatturaPA's own schema and 0..1 in EN → never blocking. Not note: R2 (uapi-map UAPI_LOSSY_FIELDS line 650; spec `Totals`={vat} additionalProperties:false, line 7005) precedes R3 fallback; not R4 because row has no JSON pointer (fate undefined) and totals' fate is _discarded_, not platform (docs/reference/fatturapa/README.md line 85: "breakdown[] and totals are discarded — DatiRiepilogo is always recomputed server-side"). Loss is real: capture tested-response.xml emits ImportoTotaleDocumento (line 71) but no Arrotondamento — an authored nonzero rounding is not derivable from lines, so recomputation can never reproduce it.

**How to apply:** for `{ubl,cii}|totals.prepaid|json` severity-correct claims, verify the same line numbers still hold, then confirm. See [[lines-id-severity-evidence]] and [[vatexcode-severity-evidence]] for the same pattern on other fields.
