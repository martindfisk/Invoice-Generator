---
name: reference-verification-shortcuts
description: Fastest authoritative sources for judging gap-report rows (fiskaly spec BT annotations, XRechnung model cardinality convention, capture scope)
metadata:
  type: reference
---

Where to settle each gap-report proposition fastest:

- **gap-is-real / reason-true (missingFrom=json)**: the active spec `spec/fiskaly.unified-api.all.<version>.yaml` annotates business terms per country inside schema _descriptions_ as `(BT-xx Term name)` under flag-emoji country headings (`DE_EI`, `BE_EI`, `IT_EI`). `grep "(BT-` is decisive: an annotation proves the operation carries the term; its absence across the whole file is strong evidence it does not. Parse YAML with `backend/.venv/bin/python` (system python3 lacks PyYAML).
- **XRechnung cardinality**: `.../E-Invoicing-Formats-and-Profiles/Germany/xrechnung-3.0.2-bundle-2026-01-31/xrechnung-3.0.2-xrechnung-model-2026-01-31/model/xrechnung-cius-model.xml` — semantic structure section uses `<m:term ref="BT-xx" min-occurs="0"/>`; **absence of min-occurs means required**. XRechnung tightens EN: BT-10, BT-34, BT-49 (+scheme, BR-63), BG-6/BT-41/42/43, BG-16, BT-119 all required.
- **Capture scope**: `docs/reference/fatturapa/` is ONE FatturaPA observation (2026-08-25). Usable only by analogy for UBL/XRechnung/CII rows — say so explicitly. It proves: seller identity/breakdown/totals are platform/recomputed; `entries[].details.number` was discarded.
- **Tool self-knowledge**: `frontend/src/uapi-map.ts` `SAME_DATUM` + comments already concede BT-49 is carried via `recipients[].invoicing`; gap-report.ts structural rows can contradict this — check before confirming "no pointer" reasons.
- Known contract facts (spec 2026-06-01): instruction `text` = BT-83, `document.payment_terms` = BT-20 (separate); `totals.vat.exclusive` = BT-106+BT-109+BT-116; `VatExemptionReason` (line level) = BT-120; `CreditTransferPaymentInstruction` requires all of account+name+payment_service_provider; `Shipping` requires `address`.
