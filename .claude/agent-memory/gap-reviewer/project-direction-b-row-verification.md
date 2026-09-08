---
name: direction-b-row-verification
description: How to verify "operation|<pointer>|model" gap rows — check uapi-map composer functions for derived/hardcoded values, not just the pointer tables
metadata:
  type: project
---

`NO_MODEL_FIELD` rows ("The operation accepts this pointer but no model field addresses it") can be false even when `UAPI_POINTER_FIELDS` has no entry, because `toInvoiceTransaction` composers in `frontend/src/uapi-map.ts` derive values: e.g. `product()` fills `details.name` from `line.name` and hardcodes `type: "OTHER"`; `payment()` emits only amount/currency/date.

**Why:** verified 2026-09-07 against spec 2026-06-01 — the row for `/entries/{i}/data/product/details/name` was refuted this way while `/entries/{i}/data/product/type` (constant, six spec enum values inexpressible) was confirmed.

**How to apply:** for any direction-B row, read the composer function that owns the pointer's parent before trusting the reason. Also: `specGaps()` in `gap-report.ts` filters with `derived.has(entry.pointer)` where `entry.pointer` is `{i}`-slash-templated but `UAPI_DERIVED_PATHS` uses bracket syntax (`entries[].data.unit.factor`) — the filter never matches, so derived paths are only suppressed when the country preset populates them (the IT preset sets `lines[].uapi.itemNumber`, which is why product pointers show only BE_EI/DE_EI applicability). Severity rules R1–R4 live at `gap-report.ts:144-183`; direction-B `required` is branch-relative (conditional on the optional parent group existing).
