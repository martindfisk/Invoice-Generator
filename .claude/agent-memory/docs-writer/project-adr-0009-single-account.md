---
name: project-adr-0009-single-account
description: ADR-0009 removed the seller/buyer persona split and made settings persist; what it changed in README/handbook/demo-script and what still names ADR-0005
metadata:
  type: project
---

Landed 2026-09-11 on branch `Receive-removed` (docs/adr/0009-single-account-persisted-settings.md).
Amends ADR-0005 rather than replacing it — write-only credential contract (fingerprint back, never
a secret) still stands; what changed is that credentials no longer live only in backend memory.

**Facts to keep straight when touching docs:**

- One credential set: `UAPI_API_KEY`/`UAPI_API_SECRET` + `UAPI_SYSTEM_ID_{IT,BE,DE}` /
  `UAPI_TAXPAYER_ID_{IT,BE,DE}`. No `SELLER_*`/`BUYER_*` vars, no aliases. `X-Persona` header,
  `PersonaSwitch.tsx` and per-persona `CallRecord`/settings are gone from the codebase entirely
  (verified by grep — only false-positive matches like "personalise"/"personal-use" remain).
- Settings persist to `backend/.uapi-settings.json` (git-ignored, chmod 600, atomic writes) via
  `backend/app/store.py::SettingsStore`. Semantics: key present in file = authoritative; explicit
  `null` = cleared (overrides `.env`); key absent = falls back to `.env` (bootstrap-only). Survives
  backend restarts — this is the headline behavior change worth repeating in the README and tour.
- Two modes only: MOCK (fixture replay) and LIVE (real calls, host = whatever the stored
  environment credentials point at — TEST or PRODUCTION). One UI status badge: `MOCK`,
  `LIVE · TEST API`, `LIVE · PRODUCTION` — red banner reserved for the last one. This replaced two
  separate badges (an "environment" badge and a "mode" badge) that used to both say LIVE.
- Runner (`frontend/src/runner.ts`, `RunnerPane.tsx`, `backend/app/collections.py`): Stop now
  pauses (steps not reached stay pending, next run resumes rather than reporting "skipped"); a
  summary line "N of M steps run against the API; the rest are skipped with a reason inline"; Run
  all is disabled with a reason while a required variable is unset; the Peppol proof-of-ownership
  folder is skipped with "complete it in the fiskaly dashboard" rather than attempted; binary
  (`.zip`) steps no longer break the Italian collection.
- `it-restaurant-b2g-fpa12` preset (`frontend/src/presets.ts`) documents in its own description that
  the UAPI only accepts 7-character SDI destination codes, so its legally-correct 6-character B2G
  code is rejected by the live API contract check — this is a documented known limitation, not a
  bug to chase.

**Files touched for this ADR** (2026-09-11): README.md (.env setup, LIVE vs MOCK sections),
docs/handbook/01-overview.md, 07-send-and-backend.md, 08-infrastructure.md (no changes needed — no
persona/session mentions there), 10-tour.md (header bar, Test runner, Settings sections),
docs/DEMO-SCRIPT.md (setup checklist only — the "seller"/"buyer" mentions elsewhere in that file
are invoice parties, BG-4/BG-7, and are correctly left alone).

See also [[feedback-doc-ownership-boundaries]].
