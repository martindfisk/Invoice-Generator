---
name: xrechnung-cius-model-bg22
description: How to read the XRechnung 3.0.2 CIUS model XML and the verified BG-22 cardinalities (BT-106..115)
metadata:
  type: reference
---

XRechnung 3.0.2 CIUS model (`.../xrechnung-3.0.2-bundle-2026-01-31/xrechnung-3.0.2-xrechnung-model-2026-01-31/model/xrechnung-cius-model.xml`, semo-xml format):

- Authoritative cardinalities live in `<m:structure id="invoice">` (~lines 3217–3456). Terms default to mandatory; optionality is the literal attribute `min-occurs="0"`.
- BG-22 verified (lines 3377–3388): BT-106, BT-109, BT-112, BT-115 mandatory; **BT-107, BT-108, BT-110, BT-111, BT-113, BT-114 all `min-occurs="0"`**.
- Rules attach via `on-terms="BT-xxx"` attributes (~lines 2560+). Only BR-CO-11/12 attach to BT-107/108; nothing attaches to BT-113/114.
- XRechnung's own schematron (bundle `xrechnung-3.0.2-schematron-2.5.0`) adds **no presence mandate** on any BG-22 amount — PrepaidAmount/PayableRoundingAmount appear only in `if (exists(...)) then ... else (0)` variables; AllowanceTotalAmount/ChargeTotalAmount not at all.
- CEN BR-CO-11/12 (vendor/schematron/CEN-EN16931-UBL.sch lines 66–67) are conditional: escape branch `not(cbc:AllowanceTotalAmount) and not(../cac:AllowanceCharge[...])` makes absence legal when no BG-20/BG-21 exist. BR-CO-16 (line 69) branches on exists() for BT-113/114.

**How to apply:** for `*|totals.allowance|*`, `*|totals.charge|*`, `*|totals.prepaid|*`, `*|totals.rounding|*` rows in any UBL-bound format, "optional term → should-fix" verdicts are supportable from these lines without re-deriving. See also [[bt72-bric11-nuance]] for the pattern of conditional-rule nuances.
