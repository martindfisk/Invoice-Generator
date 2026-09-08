---
name: model-gap-pitfalls
description: Two systematic traps when verifying missingFrom=model rows — BT-154 mis-wiring in uapi-map and anyOf applicability leak in fields.py (found 2026-09-07)
metadata:
  type: project
---

Two defects found while verifying the 31 fatturapa/model rows of `docs/gaps/gap-report.json` (2026-09-07):

1. `frontend/src/field-registry.ts:391` registers `lines.{i}.description` as **BT-154 Item description** (ubl-map/cii-map agree), but `uapi-map.ts` `UAPI_POINTER_FIELDS` wires it to `/entries/{i}/details/description`, which the 2026-06-01 spec annotates as **BT-127 Invoice line note**. The spec's BT-154 home is `/entries/{i}/data/product/details/label` and receives nothing. So the row `operation|/entries/{i}/data/product/details/label|model` had gap-is-real refuted: the model carries the term; only the wiring is missing.
2. `backend/app/fields.py` `_applicability` defaults an unannotated description to `applicable`. For multi-branch `anyOf` pointers (e.g. `FiscalLocation` France/Portugal/Generic) the unannotated branch wins in the gap report even when the annotated branch says "Not required" for IT_EI/BE_EI/DE_EI (spec ~4848–4856). Row `operation|/entries/{i}/data/vat/fiscal_location/region|model` had applicability-correct refuted for this.

**Why:** both are cross-table mismatches no schema check catches; `make gap-check` passes on them.
**How to apply:** on any future `/gap-audit` run, re-check whether these were fixed (rewired uapi-map row; regenerated report applicability) before repeating the refutations; if fixed, delete this memory. Also remember: `operation|…|model` rows carry `format: "fatturapa"` only as a bucketing artifact (one row per pointer, first snapshot = IT) — the claim is a property of the operation, not of the Italian syntax.
