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

- `make dev` runs uvicorn `--reload`; a reload triggered by editing backend files hangs forever on "Waiting for connections to close" whenever a browser tab holds the `/api/events` SSE stream. The port accepts but never responds. Fix: kill only the stuck worker (`spawn_main` child), never the reloader parent — it respawns with the new code.

- Postman-collection step names repeat across folders (BE has two "Create TRANSACTION::INVOICE"), so `run_id + step_name` alone is ambiguous. `matchStepCalls` in `runner.ts` consumes contiguous same-name call groups in step order; `StepResult.runId`/`sent` (set by the pane/engine) are what make the lookup deterministic.
