---
name: fatturapa-payment-tpmp-evidence
description: fatturapa payment.conditions + payment.italianMeansCode json rows — should-fix confirmed; silent TP/MP substitution proven by XSD + capture + closed spec
metadata:
  type: project
---

Both `fatturapa|payment.conditions|json` and `fatturapa|payment.italianMeansCode|json` are correctly R2 should-fix (confirmed 2026-09-07). The failure mode is **silent substitution**, not omission: authored TP01/MP12 becomes TP02/MP05 in the transmitted XML.

**Why:** evidence chain — XSD `Schema_VFPR12_v1.2.3.xsd`: `DatiPagamento` minOccurs="0" (line 40) but `CondizioniPagamento` (line 793) and `ModalitaPagamento` (line 821) have no minOccurs → 1..1 mandatory _within_ the block; TP01="pagamento a rate" vs TP02="pagamento completo" (lines 801-810) so the swap is semantically material. Capture: `docs/reference/fatturapa/tested-payload.json` has no TP/MP code anywhere (instruction = CREDIT_TRANSFER {account,name,payment_service_provider}); `tested-response.xml` lines 103/105 show TP02/MP05 → values are derived. Spec fee9b16d1c7c: all three instruction schemas (`CreditTransfer|DirectDebit|Unknown PaymentInstruction`) are `additionalProperties: false` with no TP/MP-like property; grep for MP05/TP01/means_code/conditions in components.schemas = all false. Model side: `model.ts` 179-180 (`conditions?: "TP01"|"TP02"|"TP03"`, `italianMeansCode?: string`), `fatturapa-map.ts` 600-614 renders both locally → xml mapped + json missing = R2 per `docs/gaps/README.md` line 52.

**How to apply:** not R1 because the block is optional in FatturaPA's own XSD and the gateway keeps the XML schema-valid with derived codes; not R3 because the loss substitutes meaning (installments→full, RIBA→bonifico). "Mandatory-within-optional-block + no request slot → always derived when rendered" is a sound deduction, no web needed. Cited FatturaPA's own XSD, not EN 16931 analogy. Related: [[gap-report-severity-taxonomy]], [[severity-rule-precedence]].
