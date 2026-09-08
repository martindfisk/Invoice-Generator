---
name: direction-b-rows-preset-dependent
description: How to judge missingFrom=model gap rows - coverage() is preset-shape-dependent, severityFor ignores optional_ancestor, and UAPI_DERIVED_PATHS omissions create false positives
metadata:
  type: project
---

Direction-B (`missingFrom: "model"`) gap rows are computed from `coverage(spec, composedPreset)` per country snapshot, so a row's existence and its `applicability` list depend on which preset happens to populate the pointer — not on the standard. Three checks settle most of them fast:

1. **UAPI_DERIVED_PATHS omission?** If the composer (`uapi-map.ts`) hard-codes the pointer's value (single-value enum discriminators like `line.type = "STREET_NUMBER"`, `recipients[].type`), the gap is not real; the pointer just isn't declared in `UAPI_DERIVED_PATHS` (uapi-map.ts ~751). Proven for `operation|/recipients/{i}/shipping/address/line/type|model` (2026-09-07).
2. **`required` is branch-relative.** `fields.py` sets `required: true` inside optional branches and provides `optional_ancestor` exactly so consumers do not report those as missing requirements (comment at fields.py ~220), but `severityFor()` in gap-report.ts (~179) reads only `entry.required` → spurious should-fix for pointers required-within-optional objects.
3. **Applicability list = "snapshots where the compose left it unpopulated"**, not "profiles the spec applies it to" — contrast sibling rows (prefix/infix/suffix listed IT+BE+DE; type listed DE only because IT/BE presets carry `uapi.delivery.address`).

**Why:** these three mechanics produced a false-positive should-fix row that survived `make gap-check` (all mechanical assertions true, semantics wrong).

**How to apply:** for any direction-B row, first grep the composer for a hard-coded emission of the pointer, then read the catalogue row (`fields.field_metadata`) for `optional_ancestor`, before reaching for standards documents.
