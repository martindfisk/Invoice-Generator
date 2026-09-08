---
name: esigibilita-severity-evidence
description: fatturapa vatBreakdown.{i}.esigibilita json row — should-fix confirmed; evidence chain for EsigibilitaIVA D/I/S across spec, XSD, capture
metadata:
  type: project
---

`fatturapa|vatBreakdown.{i}.esigibilita|json` severity-correct (should-fix, R2) confirmed 2026-09-07.

Evidence chain:

- XSD: `vendor/fatturapa/Schema_VFPR12_v1.2.3.xsd` line 1052 `EsigibilitaIVA` minOccurs="0" in `DatiRiepilogoType`; type enum lines 1056-1076: D "esigibilità differita", I "esigibilità immediata", S "scissione dei pagamenti". Optional → never R1-blocking; no SDI 004xx control requires presence (00420 only forbids S with N6).
- Spec fee9b16d1c7c (2026-06-01): zero hits for esigibil/split payment/scissione/cash accounting/chargeab/differita. `VatBreakdownRateEntry` (line 7823), `VatBreakdownExemptionEntry` (7850), `VatBreakdownReverseChargeEntry` (7868) all `additionalProperties: false` — no slot anywhere. So "operation cannot deliver an authored D or S" is contract-proven, not just capture-proven.
- Capture: `docs/reference/fatturapa/tested-response.xml` contains NO EsigibilitaIVA element — the server-side recomputed DatiRiepilogo omits it (recipient reads default = immediata). breakdown[] is discarded per README line 85.
- Client side: `fatturapa-map.ts` 585-586 renders `${SUMMARY}/EsigibilitaIVA`; `ESIGIBILITA_DEFAULT = "I"` (line 16). Fate for the lossy reason string is "unknown" (uapi-map.ts ~711) → no R4.
- Fiscal reality of the loss: S = split payment art. 17-ter DPR 633/72 (buyer remits VAT to Treasury; payable excludes VAT); D = deferred chargeability art. 6 c.5 DPR 633/72 / IVA per cassa art. 32-bis DL 83/2012 (RegimeFiscale RF16/RF17). Both change who/when VAT is remitted — genuinely "real fiscal information".

**Why:** the row is FatturaPA-native (bt: null) so it is judged against the XSD directly, no EN 16931 analogy needed. Related: [[gap-report-severity-taxonomy]], [[severity-rule-precedence]].

**How to apply:** sibling rows `cii|ubl|xrechnung vatBreakdown.{i}.esigibilita|xml` (gap-report lines ~1210/4406/5664) are missingFrom=xml — for those the question is whether EN syntaxes carry an equivalent: BT-8 (VAT point date code, UNCL2005 code 432 "paid date") partially covers D/cash-accounting semantics but nothing in EN 16931 expresses split payment S; check whether the row reason claims "no counterpart" too strongly for D before confirming.
