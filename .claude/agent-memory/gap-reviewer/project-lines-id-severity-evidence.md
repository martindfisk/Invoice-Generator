---
name: lines-id-severity-evidence
description: Evidence chain that settles severity for all four lines.{i}.id gap rows (ubl + xrechnung + cii + fatturapa ALL confirmed should-fix)
metadata:
  type: project
---

All four `*|lines.{i}.id|json` severity-correct claims **confirmed** (should-fix, not blocking): ubl + xrechnung + cii on 2026-09-07 (details below), and `fatturapa|lines.{i}.id|json` (gap-report.json lines 1906-1922) on 2026-09-07 too.

FatturaPA leg specifics: XSD `vendor/fatturapa/Schema_VFPR12_v1.2.3.xsd` — `DettaglioLineeType` line 1000, `NumeroLinea` line 1002 (no occurs attrs = 1..1), `NumeroLineaType` lines 1427-1432 = xs:integer 1..9999 (mandatory, numeric, NOT forced sequential — authored numeric ids differing from position ARE syntax-representable). Discard statement: `docs/reference/fatturapa/README.md` lines 89-90 ("We currently send details.description and details.number; both go nowhere"). Correction note: spec line 7228 — "In case of a correction record, this number is required as it indicates the original entry number being corrected." Never blocking: gateway always fills NumeroLinea from position, so the XML never lacks the element; FatturaPA's own XSD requirement is satisfied platform-side (no EN-by-analogy needed).

**Why:** The chain is cross-file and slow to reassemble: (1) BR-21 flag=fatal at `vendor/schematron/CEN-EN16931-UBL.sch:142` (UBL) and `EN16931-CII-validation.xslt:1287` (CII); (2) spec `EntryNumber` (fiskaly.unified-api.all.2026-06-01.yaml lines 7225-7230) is `UnsignedInteger4`, optional, position fallback documented — so non-numeric authored ids can never be carried, a structural loss independent of the discard; (3) severity rules R1-R4 in `docs/gaps/README.md` ~lines 49-57 — R2 = "syntax renders it but the operation cannot carry it"; (4) round-trip fallback `String(index + 1)` in `frontend/src/uapi-map.ts` lineFrom().

**How to apply:** Pitfall — fatturapa rows' `source` says `uapi-map.UAPI_PARTIAL_FIELDS` but the quoted evidence strings live in `frontend/src/uapi-field-fate.ts` (details.number at lines 261-267); grep there, not uapi-map.ts. Capture caveat: `tested-payload.json` did NOT send `details.number` (single entry, NumeroLinea=1 back), so the capture proves the position-default only; discard-when-sent rests on the README/fate declaration — verdict is robust anyway, since even an honored EntryNumber would still lose non-numeric ids (UnsignedInteger4 vs free-string BT-126) → still R2.
