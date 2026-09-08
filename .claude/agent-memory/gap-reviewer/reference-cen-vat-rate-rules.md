---
name: cen-vat-rate-rules
description: CEN EN16931 schematron rule-id map for VAT categories and how BT-119=0 is pinned (directly at line level, indirectly at breakdown level)
metadata:
  type: reference
---

When verifying VAT-rate derivability claims against `vendor/schematron/CEN-EN16931-UBL.sch`:

- Rule-id prefixes per UNCL5305 category: S → BR-S, Z → BR-Z, E → BR-E, AE → BR-AE, **K → BR-IC** (intra-community), G → BR-G, O → BR-O, **L → BR-AF** (IGIC), **M → BR-AG** (IPSI). Grepping "BR-K" finds nothing — that mistake costs a wrong refutation.
- Suffix meaning: -05 line rate (BT-152), -06 doc allowance rate (BT-96), -07 doc charge rate (BT-102), -08 breakdown taxable amount (BT-116), -09 breakdown VAT amount (BT-117), -10 exemption reason.
- BR-48 (BG-23 shall have BT-119 except category O) is fatal; its test literally exempts only `cbc:ID='O'`.
- There is **no literal "BT-119 shall be 0" assert** for E/AE/Z/K/G breakdowns. The pin is: -05/-06/-07 fix all source rates to 0, -09 fixes BT-117 to 0, and BR-CO-17 (BT-117 = BT-116 × BT-119/100) then admits only 0. "EN pins the rate to 0" is accurate in effect, not as a single assert.
- PEPPOL-EN16931-UBL.sch adds no rule on TaxSubtotal/ClassifiedTaxCategory Percent (only R041/R042 on allowance/charge percentage).
- UAPI 2026-06-01 vat rows are a discriminated union: `VAT_RATE` requires `percentage`; `VAT_EXEMPTION` and `VAT_REVERSE_CHARGE` have no percentage property — so a "missing rate" gap only ever concerns categories whose rate EN fixes at 0 or forbids (O).
- Confirmed 2026-09-07 for `xrechnung|lines.{i}.vat.rate|json` (BT-152) and `xrechnung|vatBreakdown.{i}.rate|json` (BT-119): should-fix stands. XRechnung CIUS-model legs: BT-119 bare ref (= required) in BG-23 at line 3393, `BT-152 min-occurs="0"` in BG-30 at line 3439, BR-48 rule at 2432 whose German description itself instructs "ist '0' zu übermitteln" when exempt — the CIUS model supplies the breakdown-zero rule the -05 asserts don't cover. See [[xrechnung-cius-model-conventions]].
