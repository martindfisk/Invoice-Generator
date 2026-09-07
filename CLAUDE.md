# Invoice Generator — e-invoice flow showcase & fiskaly Unified API harness

Browser tool: **create → validate → send** e-invoices (FatturaPA via SDI; Peppol BIS 3.0, XRechnung and CII via Peppol/email) with a split screen — workflow left, live fiskaly UAPI calls right. Dual track: the browser generates the _expected_ XML; fiskaly generates and transmits the real one (`?compliance-artifact`); the DiffView compares both.

## Commands

`make setup` (Node via brew, npm install, venv, spec fetch, type gen) · `make doctor` · `make dev` (backend :8000 + Vite :5173) · `make test` · `make e2e` (Playwright, MOCK) · `make lint` · `make spec` (ingest `spec/drop/*.yaml`, else refresh from workspace.fiskaly.com) · `make spec-check` · `make schemas` / `make sef` (validation assets) · `make docker`.

## Layout

`frontend/` React+TS+Vite (flat `src/`) · `backend/` FastAPI proxy (flat `app/`) · `spec/` UAPI specs (`version.txt` = `X-Api-Version`, `spec.json` = provenance, `drop/` = drop a new OAS here) · `tools/` stdlib scripts · `docs/` ARCHITECTURE, DEMO-SCRIPT, adr/, design/ · `.claude/` agents, skills, rules, hooks, workflows.

## Rules that matter most

- Secrets only in `.env`; the browser never sees credentials; hooks block `.env*` writes.
- `spec/*.yaml` is the API authority; `spec/spec.json` names which one is active. bodex/Postman `2026-05-04` bodies are v4 and stale.
- Money = decimal strings. Mapping tables are data; writers emit only through them.
- Live and mock share one code path (mock = httpx transport). Never compile Schematron at runtime.
- Before fetching a standard from the web, check `/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/local_specs_index.md`.
- No commits/pushes unless asked. Report: files, verification commands + results, open items.

## Who does what (`.claude/agents/`)

| Ask                                                          | Agent                      |
| ------------------------------------------------------------ | -------------------------- |
| ADRs, boundaries, spike write-ups                            | `architect`                |
| Mockups, tokens, interaction specs                           | `ux-designer`              |
| React shell, viewer, API pane                                | `frontend-engineer`        |
| Model, mapping tables, UBL/FatturaPA writers, presets        | `einvoice-domain-engineer` |
| XSD/Schematron/SDI rules, SEF build, xml-locate              | `validation-engineer`      |
| FastAPI app, recorder, mock transport, routes                | `backend-engineer`         |
| UAPI client/choreography, spec fetch, fixtures, spikes | `fiskaly-api-integrator`   |
| Tests, Playwright, CI test job                               | `qa-engineer`              |
| Standards/legal review (read-only)                           | `compliance-reviewer`      |
| Verify gap-report claims with citations                      | `gap-reviewer`             |
| Makefile, Docker, CI, env                                    | `devops-engineer`          |
| README, demo script, handbook                                | `docs-writer`              |

Workflows: `/compliance-audit` (fixtures vs standards), `/gap-audit` (verify `docs/gaps/` claims, offline sources first), `/review-change` (diff review, 3 lenses). Skills load automatically per agent; see `.claude/skills/*/SKILL.md`.

@docs/ARCHITECTURE.md
