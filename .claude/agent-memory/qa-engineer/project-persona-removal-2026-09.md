---
name: project-persona-removal-2026-09
description: 2026-09-11 buyer/seller persona concept removed; flat settings contract; what the test suites now assert
metadata:
  type: project
---

The buyer/seller credentials-persona concept was removed (2026-09-11). Flat contract: one
credential set, `Settings/Config.systems` keyed by country; `ApiCall` has no persona;
`errorCode()` reads the backend's structured 409 `detail.code` (`SYSTEM_ID_MISSING` gates the
MOCK passthrough fallback); runner stop-is-pause (`stoppedAt`, un-run steps stay `pending`,
`stoppedLine`/`runnableSummary`); notes dismissal persists per collection id under
`runner:notes-dismissed`; `StatusBadge` replaced ModeBadge/EnvironmentBadge; PersonaSwitch
deleted; SettingsDialog sections: Mode / Environment credentials / Identifiers / Validation
rules / Local preferences.

**Why:** major contract refactor on branch Receive-removed; tests were rewritten to the flat
shapes and persona-only tests deleted (not hollowed out).

**How to apply:** backend collection parse truth (verified 2026-09-11): DE 28 steps / 13
runnable / 6 notes; BE 39 / 24 / 2; IT 46 / 29 / 1 — the whole Peppol proof-of-ownership
folder is skipped. Persisted v4 workflow blobs with a `persona` key are ignored on restore
(covered in workflow.test.ts).
