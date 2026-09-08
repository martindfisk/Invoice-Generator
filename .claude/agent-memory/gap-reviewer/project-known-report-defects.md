---
name: project-known-report-defects
description: Recurring gap-report defect patterns found in the 2026-09 fatturapa/json review — where rows are likely wrong
metadata:
  type: project
---

Defect patterns found reviewing fatturapa/json rows (2026-09-07), likely to recur in other format/missingFrom slices:

- **`NO_POINTER` fallback overclaims.** `gap-report.ts` emits "The operation has no pointer for this field" whenever `uapi-map.ts` lacks a row — but the contract may carry the term (BT-49 via `invoicing.destination_code`, BT-120 via line-level `vat.reason`). Always check the spec before trusting that reason.
  **Why:** the reason conflates "our mapping table has no row" with "the operation has no pointer".
  **How to apply:** for every NO_POINTER row, grep the spec descriptions for the BT label first.
- **Platform rows escape R4.** Seller.* and typeCode rows carry R2/should-fix although the capture declares them platform/derived (→ R4 note per `severityFor` precedence), because `uapi-field-fate.ts` keys fates on JSON pointers and model fields without a pointer get no fate. Their `evidence` is null even though the capture speaks to them.
- **Loose prose in curated reasons.** Two verified cases: "The payment instruction is a bank transfer or nothing" (contract has CREDIT_TRANSFER | DIRECT_DEBIT | UNKNOWN; the tool's own `UapiPaymentInstruction` type omits DIRECT_DEBIT, which bred the wording), and "BT-16's date" (EN BT-16 has no date; the mandatory date is FatturaPA's DataDDT). Substance can be right while the contract/EN description is wrong — judge reason-true against the contract text.
- **Zero-information gaps rated should-fix.** Rate-on-exemption rows (BT-119/BT-152) can only ever be 0 (SDI 00401/00430; BR-E-05/BR-AE-05 by analogy) and the breakdown is recomputed server-side — nothing authorable is lost, note fits R3 better.
