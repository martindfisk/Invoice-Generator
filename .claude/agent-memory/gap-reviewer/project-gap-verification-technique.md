---
name: gap-verification-technique
description: Pitfalls and fast paths when verifying gap-report rows against Schematron and the UAPI spec
metadata:
  type: project
---

When grepping vendored Schematron for a business term, always boundary-match the BT id (`grep -E "BT-14[^0-9]|BT-14$"`) — plain `BT-14` false-positives on BT-140..BT-148. Same for any two-digit BT.

**Why:** A plain grep made it look like CEN-EN16931-UBL.sch referenced BT-14 when every hit was BT-14x; a wrong "citation refuted" verdict would have followed.

**How to apply:** Any absence claim ("no assert requires BT-x") needs the boundary grep on both `vendor/schematron/CEN-EN16931-UBL.sch` and `vendor/schematron/PEPPOL-EN16931-UBL.sch` (the Peppol layer can make an EN-optional term mandatory, e.g. R003 for BT-10/BT-13), plus a check of asserts on the carrying UBL element (e.g. `SalesOrderID`, `DocumentTypeCode='130'`) — form-when-present constraints like UBL-SR-04 "maximum once" are not requirements.

Fast paths for the recurring legs of a severity-correct claim:

- Cardinality: `frontend/src/bt-catalog.json` (generated from the local EN 16931 reference).
- "Rendered by the syntax": the format's `*-map.ts` row must carry a real `path`, not an `unsupportedReason`.
- "Unconditionally lost": field listed in `UAPI_LOSSY_FIELDS` in `frontend/src/uapi-map.ts` AND the spec schema is closed — `DocumentReferences` and `Document` in `spec/fiskaly.unified-api.all.2026-06-01.yaml` are `additionalProperties: false`, so absence of a property is proof the operation cannot carry it under any condition.
- Severity routing per `docs/gaps/README.md`: R2 (should-fix) triggers structurally on "xml mapped + json —" regardless of optionality; R3 (note) is for format-level absence of optional terms (missingFrom: xml). Optional cardinality alone does not demote an R2 row to note.

CII has no vendored `.sch` — only compiled `vendor/schematron/EN16931-CII-validation.xslt`. To judge a CII-SR "should not be present" hit, extract the nearest preceding `<svrl:fired-rule context="...">` before the assert id (regex on the XSLT text): CII-SR-107 "SellerOrderReferencedDocument should not be present" fires at **line** level (`.../ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement`), so it does NOT forbid the header-level BT-14 binding `ApplicableHeaderTradeAgreement/ram:SellerOrderReferencedDocument` that cii-map.ts renders. CII-SR restriction rules routinely look like element bans until you read their context. Note: the shell's default grep is ugrep and chokes on long `-oE` context patterns against the big XSLT — use python re instead.
