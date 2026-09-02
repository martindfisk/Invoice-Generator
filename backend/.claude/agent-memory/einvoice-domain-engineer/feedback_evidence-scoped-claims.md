---
name: evidence-scoped-claims
description: Never trim the UAPI payload to one syntax's observed gateway behaviour; scope captured-evidence claims to the format they were observed on
metadata:
  type: feedback
---

When a capture proves the gateway ignores a field on one path (e.g. FatturaPA discards `entries[].details.description`, `breakdown`, `totals`), do NOT stop sending the field — make the consequence visible instead (fate table `uapi-field-fate.ts`, notes, tests).

**Why:** The user's explicit instruction (2026-09 field-fate task): "Making the consequence visible is the fix, not silently changing the payload." Evidence from `docs/reference/fatturapa/` covers FatturaPA/IT only; the same field may feed the UBL/CII paths, and `breakdown`/`totals` are schema-required even though discarded — both facts are true at once and both must be stated.

**How to apply:** Any time gateway behaviour is encoded as data or tests: scope the claim by format (fate tables answer `undefined` for formats without evidence), keep emitting schema-valid fields, and treat "no entry" as "no evidence" rather than "mapped". Frontend tests pin that discarded-on-IT fields are still emitted (`frontend/tests/uapi-field-fate.test.ts`).
