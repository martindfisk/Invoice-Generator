---
name: references-trio-evidence
description: Verified evidence chain for the references.salesOrder/invoicedObject/despatchAdvice.issueDate lossy trio (uapi-map.ts:582-583) — fatturapa json rows confirmed should-fix
metadata:
  type: project
---

The UAPI_LOSSY_FIELDS reason "document.references carries neither BT-14 nor BT-18, and despatch_advice is a bare number without BT-16's date" (uapi-map.ts:582-583) covers three fields: `references.salesOrder`, `references.invoicedObject`, `references.despatchAdvice.issueDate`. Confirmed 2026-09-07 for the two fatturapa/json rows (issueDate + invoicedObject): should-fix/R2 correct.

**Why:** every leg checked out. Spec `fiskaly.unified-api.all.2026-06-01.yaml` `DocumentReferences` is closed (additionalProperties:false, 8 props: buyer, project, contract, purchase_order, despatch_advice, tender, buyer_routing, preceding_document) — no BT-14/BT-18 slot; `DocumentReferencesDespatchAdvice` = bare `AlphaNumerical32` (spec line ~6925, annotated "BT-16"), unlike `preceding_document` which is an object with number+issued_at. XSD `Schema_VFPR12_v1.2.3.xsd`: `DatiDDTType` lines 500-506 — NumeroDDT AND DataDDT both mandatory (no minOccurs), so a bare number can never fill a valid DatiDDT; DatiDDT itself minOccurs=0 in DatiGeneraliType (line 109) → never blocking. fatturapa-map.ts:414 (invoicedObject → DatiRicezione/IdDocumento, "nearest slot" analogy), :442 (issueDate → DatiDDT/DataDDT); fatturapa-write.ts:130 gates DatiDDT on number && issueDate.

**How to apply:** for the sibling `references.salesOrder` row (any format) the json-side evidence is identical — closed DocumentReferences settles it. `docs/reference/fatturapa/README.md` lines 70-73 ('Correction to the source on despatch_advice'): the capture proves acceptance, NOT whether the gateway renders DatiDDT — do not cite the capture as proof of rendering either way; the contract-level "unfillable from JSON" argument is independent of gateway behavior. See [[gap-report-severity-taxonomy]].
