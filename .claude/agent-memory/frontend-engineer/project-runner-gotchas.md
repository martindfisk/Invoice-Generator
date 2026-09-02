---
name: runner-frontend-gotchas
description: Non-obvious constraints hit while building the collection-runner frontend (milestones 3+4)
metadata:
  type: project
---

Facts that are not derivable from the code alone:

- macOS APFS is case-insensitive: in flat `frontend/src/`, `import "./Runner"` resolves to `runner.ts` and tsc errors with TS1149. Engine files are lower-case (`runner.ts`), view files carry a suffix (`RunnerPane.tsx`, `RunnerStep.tsx`) to avoid the collision.
- **Why:** tsc -b failed on the plan's suggested `Runner.tsx`/`runner.ts` pair.
- **How to apply:** never create a `.tsx` whose basename differs from an existing `.ts` only in casing.

- The backend recorder keeps `step: "passthrough"` and adds separate `step_name`/`run_id` fields from the `X-Step`/`X-Run-Id` headers. `stepLabel()` in `api-log.ts` (`step_name ?? step`) is the display/filter/grouping key for the log.

- The repo-root `.env` on this machine has all SELLER/BUYER `SYSTEM_ID`/`TAXPAYER_ID` keys **empty**. In MOCK the runner (like `sendInvoice`'s fallback) seeds placeholders `demo-e-invoice-system` / `demo-taxpayer`; the mock transport answers any id. E2e happy paths depend on this — LIVE seeding leaves them unset and the variable panel points to Settings → Identifiers.

- Backend `/api/collections/{id}` emits `asserts[].equals: null` for presence-only asserts (e.g. `annotations.peppol_id`) and `waitFor.timeoutS` as a float — the frontend types allow both.

- The recorder's SSE stream is shared: with Playwright `fullyParallel`, every page receives every worker's calls. Any e2e assertion that a log "starts empty" must block `**/api/events` (fulfill an empty `text/event-stream`, not abort — abort triggers the client's exponential backoff) until the assertion, then unroute. The api-log lifecycle test in `smoke.spec.ts` does this.

- `make dev` runs uvicorn `--reload`; a reload triggered by editing backend files hangs forever on "Waiting for connections to close" whenever a browser tab holds the `/api/events` SSE stream. The port accepts but never responds. Fix: kill only the stuck worker (`spawn_main` child), never the reloader parent — it respawns with the new code. When `kill` is unavailable (sandbox denies it): `touch frontend/vite.config.ts` — vite restarts itself on config change, which drops the proxied SSE sockets, the old worker can finish shutting down, and the reloader respawns. Verified 2026-09-02.

- Postman-collection step names repeat across folders (BE has two "Create TRANSACTION::INVOICE"), so `run_id + step_name` alone is ambiguous. `matchStepCalls` in `runner.ts` consumes contiguous same-name call groups in step order; `StepResult.runId`/`sent` (set by the pane/engine) are what make the lookup deterministic.

- The api-log "starts empty" e2e must block `**/api/calls` (fulfill `[]`) as well as `**/api/events`: under parallel load the history seed from `listCalls()` in `app.tsx` can resolve _after_ StepSend's `clearCalls()` and repopulate the log with other workers' recorder history. Surfaced when the entity tree started recording dozens of onboarding calls per runner page.

- Onboarding vocabularies differ: organizations/subjects are `ENABLED|DISABLED` with bare types (`UNIT`, `API_KEY`); only taxpayers/locations/systems use `ACQUIRED → COMMISSIONED → DECOMMISSIONED` with `OPERATIVE|DEGRADED` modes. Unrecognised states render neutral with the raw value, never as an error. In MOCK the organizations/subjects lists are always empty (nothing seeds them) — the tree labels them "none reported / comes with the account credentials" so it does not read as something Provision should create.

- MOCK resource state (taxpayers/systems in `mock.py`) is shared across personas and persists for the life of the uvicorn process. E2e provisioning must be re-run safe: never assert "not created" against the long-lived dev backend; provision DE with `reuse=true` so a second run yields skipped steps + `ready: true`.

- Since the 2026-09 tree rework: the runner's `collectionId` (lowercase `de|it|be`) is the _single_ source of truth for both the runner collection and the entity tree's country — `selectCollection`/`selectCountry` in `runner-actions.ts` are the only writers (refused while `running`). Persisted under localStorage `runner:collection`; tree fold under `entity-tree:open`. The selectable country list derives from `GET /api/collections` ids (fallback: `ready` keys), never a hardcoded array — that is how the France drift happened.
