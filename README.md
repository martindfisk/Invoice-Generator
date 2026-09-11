# Invoice Generator

A browser-based showcase of the e-invoice lifecycle — **Mapper → Validate → Send** — built for demos (sales, solution engineering, partners) and doubling as a test harness for the fiskaly Unified API (UAPI). The tool is dual-track: a **client-side e-invoice lab** generates and validates the XML a user expects locally, while a **UAPI harness** sends the same invoice through fiskaly, follows its lifecycle, and diffs the locally predicted XML against the XML fiskaly actually transmitted. The UI is a split screen: the workflow the user drives on the left, the live UAPI HTTP calls each step produces on the right.

## Run it

The only prerequisite is [Docker Desktop](https://www.docker.com/products/docker-desktop/) (macOS, Windows with the WSL2 backend, or Linux) and Git:

```bash
git clone <repo-url>
cd "Invoice Generator"
docker compose up --build
```

Then open **http://localhost:8080**.

- The first build takes a few minutes: it downloads the npm/pip packages and the sha256-pinned
  validation standards (XSDs, Schematron rules, the SaxonJS runtime) and compiles the Schematron
  rule sets — all inside the image build, so no Node, Python, or `make` is needed on your machine.
  After that, everything runs **offline in MOCK mode** with zero configuration: every fiskaly
  response is replayed from committed fixtures through the same client code as a live call.
- **Talking to the real TEST API** (`test.api.fiskaly.com`): open **Settings** in the app and paste
  your fiskaly TEST API key. It is saved on the backend (`backend/.uapi-settings.json`,
  git-ignored, chmod 600) and survives restarts — set it once. Alternatively, copy
  `.env.example` to `.env` and fill in the key before `docker compose up`; `.env` is only the
  bootstrap default, overridden by anything saved in Settings. (The optional `.env` is wired via
  `env_file: required: false`, which needs Docker Compose ≥ v2.24 — Docker Desktop from 2024 on
  ships it.)
- **Windows**: same two commands from PowerShell.

**Troubleshooting**

- _Port already in use_ — the app takes **8080**, the backend **8000**. Find the blocker with
  `lsof -i :8080` (macOS/Linux) or `netstat -ano | findstr :8080` (Windows), or edit the `ports:`
  mappings in `docker-compose.yml`.
- _`docker: command not found` / cannot connect to the daemon_ — Docker Desktop is not installed
  or not running.
- _Build fails downloading standards_ — a corporate proxy may block the pinned sources listed in
  `tools/rulesets.json`. `tools/fetch_assets.py` supports offline bundles via a `STANDARDS_DIRS`
  environment variable if you have local copies.
- _White page / 502 right after start_ — the frontend waits for the backend healthcheck; give it a
  few seconds and reload.

## Develop it (macOS/Linux)

Prerequisites: Python 3.13, Node ≥ 20 (macOS: [Homebrew](https://brew.sh) — `make setup`
bootstraps Node via brew if missing).

```bash
make setup      # install frontend + backend dependencies
make doctor     # check node, python, docker, .env, spec manifest, SEF freshness
make spec       # ingest spec/drop/*.yaml, else fetch the latest into spec/ (committed cache)
make gen-types  # generate TypeScript types from whichever spec is active
make schemas    # vendor XSD/XSLT validation assets into vendor/
make sef        # compile Schematron XSLT to SEF for the browser validator
make dev        # run frontend (:5173) + backend (:8000) natively, with hot reload
```

Other targets: `make test` (Vitest + pytest), `make e2e` (Playwright against MOCK), `make lint`, `make gap-report` / `make gap-check` (field-coverage gap report + CI gate), `make handbook` / `make handbook-check` (generated mapping reference + CI gate), `make sef-check` / `make spec-check` (asset freshness), `make docker` (same as `docker compose up --build`).

## Updating the OpenAPI spec

The fiskaly OpenAPI document changes with each major version. To move to a new one:

```bash
cp <whatever-you-were-sent>.yaml spec/drop/
make spec        # identifies it by content, renames it canonically, moves it into spec/
make gen-types   # regenerate the TypeScript types from it
```

`make spec` reads `info.version` and `info.title` from inside the file rather than trusting its
name, so the download can be called anything. It writes `spec/spec.json` (the active spec, the
per-country fallback, a sha256 per file) and `spec/version.txt`, which is where the backend's
`X-Api-Version` comes from — so the header follows the upgrade automatically. An empty `spec/drop/`
afterwards means the file was consumed; `make doctor` says so if one is still sitting there.

`make spec-check` (run by `make doctor` and in CI) fails when a vendored spec no longer matches its
recorded hash, when `version.txt` and the manifest disagree, or when the generated types are older
than the spec. Nothing is deleted except files the previous manifest listed.

If you drop nothing, `make spec` fetches the per-country specs from `workspace.fiskaly.com` exactly
as before, so a fresh clone and the offline path are unchanged.

## Upstream watch

`make check-updates` reports newer upstream versions without applying anything: UAPI spec CalVers
vs `spec/spec.json`, GitHub releases vs the `tools/rulesets.json` pins (cen, peppol, xrechnung),
and FatturaPA XSD sha drift. The `upstream-watch` GitHub Actions workflow runs the same check
monthly (and on dispatch) and opens **one PR per changed source** with a diff report — version and
sha transitions, added/removed rule ids, the `schematron:expected` finding diff, and in-job
verification results. Nothing lands until the PR is merged; see
[ADR-0008](docs/adr/0008-upstream-watch.md).

## `.env` setup

1. Copy `.env.example` to `.env`.
2. Fill in one Unit-level TEST API key (`UAPI_API_KEY`/`UAPI_API_SECRET`) and, per country you need, `UAPI_SYSTEM_ID_{IT,BE,DE}` / `UAPI_TAXPAYER_ID_{IT,BE,DE}`. `.env` is only the bootstrap default — the primary path is the app's **Settings** dialog, which writes whatever you enter (environment, credentials, per-country ids, mode) to `backend/.uapi-settings.json` (git-ignored, chmod 600) and it persists across backend restarts (ADR-0009).
3. Never commit `.env` or `backend/.uapi-settings.json` — both are git-ignored and hold real credentials.

## LIVE vs MOCK

- **MOCK** (default for local dev, CI, and Playwright): fixture-driven replay of recorded TEST responses, deterministic ids. No network calls to fiskaly.
- **LIVE**: real calls against whichever fiskaly host the stored credentials point at — `test.api.fiskaly.com` or `live.api.fiskaly.com`. The backend fails loudly at the point of use if credentials are missing.
- One status badge in the UI: `MOCK`, `LIVE · TEST API`, or `LIVE · PRODUCTION` (the only case with a red banner). Mode and environment are switchable at runtime from Settings.

## How the demo works

1. Pick one of the eleven presets — reference scenarios (IT/BE), a German hotel group (XRechnung/ZUGFeRD-CII) and Roman restaurant scenarios (FatturaPA, including a TD04 credit note). Deliberately broken presets are labelled.
2. **Mapper**: edit the invoice in any of its three panes — Human view, the fiskaly JSON operation (what Send actually posts), and the predicted XML — and the other two follow.
3. **Validate**: model rules, well-formedness, XSD, Schematron (EN 16931 + Peppol BIS 3.0), and FatturaPA SDI rules run client-side; findings highlight the offending field and XML range.
4. **Send**: the backend proxies the invoice to the UAPI as an `INTENTION`, then a `TRANSACTION::INVOICE`, polls it to completion, and fetches the compliance artifact — the XML fiskaly actually transmitted.
5. **Diff**: the locally generated XML is compared against fiskaly's compliance artifact, with normalisation toggles (pretty-print, ignore volatile fields — signature stripping is part of the volatile set). This is the core demo moment.
6. **Correction**: after an invoice has been transmitted, the TD04 credit-note preset composes a `TRANSACTION::CORRECTION` referencing it and sends through `POST /api/invoices/{id}/correction`. (In MOCK mode, if that endpoint is not configured, the full correction operation is posted through the raw `/api/uapi` passthrough instead — noted in the send timeline.)

A second section, the **Test runner**, replays the published fiskaly Postman collections (IT, BE, DE) step by step through the same proxy, with captures, waits and per-step cURL.

Every UAPI call made along the way appears live in the right-hand API log pane, with request/response bodies, redacted secrets, and a copyable cURL command.

## Project layout

```
Invoice Generator/
├── frontend/                  React + TS + Vite SPA
├── backend/                   FastAPI proxy
├── spec/                      UAPI specs + Postman + version.txt + spec.json (committed cache)
│   └── drop/                  drop a new OpenAPI YAML here, then run make spec
├── tools/fetch_spec.py        stdlib-only drop-in ingest + fetch/refresh of spec/
├── tools/spec_check.py        fails on a stale, tampered or un-ingested spec/
├── vendor/                    vendored XSD/XSLT validation assets (make schemas)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEMO-SCRIPT.md
│   ├── handbook/              the handbook (10 chapters + generated mapping reference)
│   ├── gaps/                  generated gap report (make gap-report)
│   ├── reference/
│   ├── adr/
│   └── design/
├── .claude/                   agents, skills, rules, hooks, workflows, settings.json
├── Makefile                   setup · doctor · spec · schemas · sef · dev · test · e2e · lint · handbook · docker
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
├── .env.example
└── CLAUDE.md
```

## Further reading

- [`docs/handbook/`](docs/handbook/README.md) — **the handbook**: how the invoices, mappings, app mechanics, validation, send lifecycle and infrastructure work, with a generated field-mapping reference and a screen-by-screen tour.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the terse map: dual-track design, module tables, UAPI choreography, frontend↔backend contract.
- [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md) — the scripted showcase for a solutions engineer.
- [`docs/adr/`](docs/adr/) — architecture decision records.

## Working with Claude Code

This repo ships a project-level agent team in `.claude/`. Ask the agent that owns the area you're touching:

| Agent                      | Ask it for                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `architect`                | ADRs, module boundaries, cross-cutting reviews, `docs/ARCHITECTURE.md`, spike write-ups                                  |
| `ux-designer`              | Split-screen grammar, viewer toggle, API pane anatomy, severity colours, `--fsk-*` token mapping, mockups                |
| `frontend-engineer`        | `frontend/` shell, workflow steps, invoice viewer, DiffView, API pane, SSE client, store                                 |
| `einvoice-domain-engineer` | Invoice model, decimal handling, presets, UBL/FatturaPA mapping tables + writers/parsers, `uapi-map.ts`, golden fixtures |
| `validation-engineer`      | SEF build, Schematron worker, SVRL → findings, FatturaPA rules, `validate.py`, `xml-locate.ts`                           |
| `backend-engineer`         | FastAPI app, settings, recorder/mask/SSE, mock transport, routes, Docker                                                 |
| `fiskaly-api-integrator`   | `uapi.py`, `workflow.py`, spec fetch + type generation, recorded fixtures, round-trip spikes                             |
| `qa-engineer`              | Vitest, Playwright, pytest suites, golden + Schematron fixture tests, CI                                                 |
| `compliance-reviewer`      | Read-only review of generated XML/labels vs. FatturaPA, Peppol BIS 3.0, EN 16931; legal citations                        |
| `devops-engineer`          | Makefile, `make doctor`, Dockerfiles/compose, `.env.example`, GitHub Actions, Node bootstrap                             |
| `docs-writer`              | README, `docs/DEMO-SCRIPT.md`, handbook, ADR formatting                                                                  |
