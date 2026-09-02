---
name: degraded-blocked-by-derivation
description: Source and rule for onboarding blocked_by=peppol-proof-of-ownership; org/subject enums are UNIT/API_KEY + ENABLED, not record-style
metadata:
  type: reference
---

`blocked_by` in `backend/app/onboarding.py` (`_blocked_by`) fires only for `(COMMISSIONED, DEGRADED)` systems holding a `PEPPOL` registration. The authority for that rule is not the spec (no reason field; `logs[]` free text) but the documented commissioning state machine in `/Users/martin.dutzler/Documents/GitHub/meta/doc/unified/e-invoice/e_invoice.md` (~lines 57-70) and `e_invoice_step_by_step_integration.md` (~line 280): Peppol countries commission into COMMISSIONED/DEGRADED until an `UPLOAD::PEPPOL_PROOF_OF_OWNERSHIP` record exists (Invopop review, up to 72 h); IT/SDI commissions straight to OPERATIVE with no proof-of-ownership. A DEGRADED SDI-only system therefore gets `blocked_by: null`.

Related spec fact that tripped up a teammate's contract sketch: Organization `type` is bare `UNIT|GROUP|ACCOUNT`, Subject `type` is `API_KEY`, and both use `state ENABLED|DISABLED` — never `ORGANIZATION::UNIT` / `COMMISSIONED` (verified in `spec/fiskaly.uapi.e-invoice-de.2026-06-01.yaml`, `Organization*`/`Subject*` schemas around lines 2280-2520). Subject list responses can carry `credentials.key` — never surface it in status payloads.
