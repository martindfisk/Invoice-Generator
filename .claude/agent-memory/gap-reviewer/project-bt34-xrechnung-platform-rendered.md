---
name: project-bt34-xrechnung-platform-rendered
description: BT-34 xrechnung/json rows — should-fix confirmed; where each half of the citation lives; DE peppol_id annotation describes the RECIPIENT (BT-49), not BT-34
metadata:
  type: project
---

The `xrechnung|seller.electronicAddress.{id,scheme}|json` rows' severity `should-fix` is **confirmed** (verified 2026-09-07).

- XRechnung 3.0.2 CIUS model (`.../Germany/xrechnung-3.0.2-bundle-2026-01-31/xrechnung-3.0.2-xrechnung-model-2026-01-31/model/xrechnung-cius-model.xml`): `<m:term ref="BT-34"/>` at line 3266 inside `m:structure id="invoice"` with **no** `min-occurs="0"` (optional siblings carry it explicitly) → required. PEPPOL-EN16931-R020 at ~line 3148 ("muss übermittelt werden"); BR-62 (~line 2497) + component `scheme-id-bt-34 min-occurs="1"` (~line 698) make the scheme mandatory too. UBL binding `cbc:EndpointID` at line 3716 — the syntax renders it, so not `blocking`.
- Active spec `spec/fiskaly.unified-api.all.2026-06-01.yaml`: `SystemAnnotations` (~line 4609) has `peppol_id` with no `required` list → optional. Operation `Seller` object = name/phone/email only, spec-glossed as **BT-41/42/43** (contact point) for BE_EI/DE_EI/IT_EI — matches the rows' reason verbatim.
- **Trap:** `PeppolIdentifierAnnotation`'s description says for **DE_EI** the peppol_id is the "PEPPOL Network Identifier of the recipient (BT-49 Buyer electronic address)" — for DE the seller BT-34 presumably derives from the Taxpayer, not this annotation. A citation using SystemAnnotations.peppol_id as the DE **seller** source is loose but does not change the severity verdict (mandatory + platform-rendered + optional platform source → should-fix either way).

**Why:** severity challenges recur on these rows; the blocking/should-fix line is "can the mandated syntax render it" — platform-rendered means it can.
**How to apply:** cite the line numbers above instead of re-grepping; challenge any future claim that peppol_id is the DE seller-BT-34 source. See [[project-bt72-bric11-nuance]] for the sibling pattern.
