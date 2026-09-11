---
name: project-persona-removal-2026-09
description: 2026-09-11 refactor removed buyer/seller personas and simplified modes to MOCK/LIVE; runner stop is now a pause
metadata:
  type: project
---

Around 2026-09-11 the app dropped the buyer/seller credentials-persona concept (single credential set) and simplified modes to MOCK (fixture replay) and LIVE (real calls; test vs production host comes from the stored environment credentials, `settings.environment`).

**Why:** one credential set is enough for the demo; the persona machinery (X-Persona header, capturedBy stale-capture tracking, per-persona settings) was complexity with no payoff.

**How to apply:**

- `passthrough(method, path, body?, key?, extraHeaders?)` — no persona arg. `Settings.systems` / `Config.systems` are keyed directly by country (`IT|BE|DE`). `ApiCall` has no persona field; `Persona` type is gone from api-log.ts. Do not reintroduce persona indexing anywhere.
- LIVE guard copy is keyed on `settings.environment`: "test" → mild TEST-environment wording, "live" → "cannot be recalled".
- Runner semantics decided in this refactor: Stop leaves un-run steps `pending` (`RunOutcome.stoppedAt`), "Run all" resumes from the first pending result; Run all/Step are disabled while `missingVariables` is non-empty; `notesDismissed` persists per collection id under localStorage key `runner:notes-dismissed`; binary passthrough responses surface as `StepResult.binary {contentType, bytes}`.
- Peppol proof-of-ownership folder steps are all backend-skipped (incl. "Retrieve System with Peppol ID"), so DE/BE runnable counts are one lower than before — never hardcode runnable counts, compute from `step.runnable`.
