# Invoice Generator

A browser-based showcase of the e-invoice lifecycle — **create → validate → send → receive** — built for demos (sales, solution engineering, partners) and doubling as a test harness for the fiskaly Unified API (UAPI). The tool is dual-track: a **client-side e-invoice lab** generates and validates the XML a user expects locally, while a **UAPI harness** sends the same invoice through fiskaly, follows its lifecycle, and diffs the locally predicted XML against the XML fiskaly actually transmitted. The UI is a split screen: the workflow the user drives on the left, the live UAPI HTTP calls each step produces on the right.

## Prerequisites (macOS)

- [Homebrew](https://brew.sh)
- Python 3.13
- Node LTS via `brew install node` (one-time)
- Docker — optional, only needed for `make docker`

## Quickstart

```bash
make setup      # install frontend + backend dependencies
make doctor     # check node, python, docker, .env, spec/version.txt
make spec       # fetch latest UAPI specs into spec/ (committed cache)
make gen-types  # generate TypeScript types from the fetched spec
make schemas    # vendor XSD/XSLT validation assets into vendor/
make sef        # compile Schematron XSLT to SEF for the browser validator
make dev        # run frontend + backend
```

Other targets: `make test` (Vitest + pytest), `make e2e` (Playwright against MOCK), `make lint`, `make docker` (compose build).

## `.env` setup

1. Copy `.env.example` to `.env`.
2. Fill in Unit-level TEST API keys for the **Seller** and **Buyer** organisations (two existing fiskaly test orgs with commissioned `E_INVOICE_SERVICE` systems).
3. Never commit `.env` — it is git-ignored and holds real credentials.

## LIVE vs MOCK

- **MOCK** (default for local dev, CI, and Playwright): fixture-driven replay of recorded TEST responses, deterministic ids. No network calls to fiskaly.
- **LIVE**: talks to `test.api.fiskaly.com` with the keys from `.env`. The backend fails loudly if secrets are missing in LIVE mode.
- Current mode is shown as a badge in the UI and is switchable at runtime.

## How the demo works

1. Pick a preset — **"Italian B2B (SDI)"** or **"Peppol BE"** — or start from a blank invoice.
2. **Create**: edit the invoice in the Human view or the generated XML view side by side.
3. **Validate**: model rules, well-formedness, XSD, Schematron (EN 16931 + Peppol BIS 3.0), and FatturaPA SDI rules run client-side; findings highlight the offending field and XML range.
4. **Send**: the backend proxies the invoice to the UAPI as an `INTENTION`, then a `TRANSACTION::INVOICE`, polls it to completion, and fetches the compliance artifact — the XML fiskaly actually transmitted.
5. **Diff**: the locally generated XML is compared against fiskaly's compliance artifact, with normalisation toggles (pretty-print, strip signature, ignore volatile fields). This is the core demo moment.
6. **Receive**: switch persona to Buyer and watch the inbox poll for the incoming reception record (or use "Simulate delivery" as a fallback).

Every UAPI call made along the way appears live in the right-hand API log pane, with request/response bodies, redacted secrets, and a copyable cURL command.

## Project layout

```
Invoice Generator/
├── frontend/                  React + TS + Vite SPA
├── backend/                   FastAPI proxy
├── spec/                      fetched UAPI specs + Postman + version.txt (committed cache)
├── tools/fetch_spec.py        stdlib-only fetch/refresh of spec/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEMO-SCRIPT.md
│   ├── adr/
│   └── design/
├── .claude/                   agents, skills, rules, hooks, workflows, settings.json
├── Makefile                   setup · doctor · spec · schemas · sef · dev · test · e2e · lint · docker
├── docker-compose.yml
├── Dockerfile.backend
├── Dockerfile.frontend
├── .env.example
└── CLAUDE.md
```

## Further reading

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — dual-track design, module tables, UAPI choreography, frontend↔backend contract.
- [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md) — the scripted showcase for a solutions engineer.
- [`docs/adr/`](docs/adr/) — architecture decision records.

## Working with Claude Code

This repo ships a project-level agent team in `.claude/`. Ask the agent that owns the area you're touching:

| Agent | Ask it for |
|---|---|
| `architect` | ADRs, module boundaries, cross-cutting reviews, `docs/ARCHITECTURE.md`, spike write-ups |
| `ux-designer` | Split-screen grammar, viewer toggle, API pane anatomy, severity colours, `--fsk-*` token mapping, mockups |
| `frontend-engineer` | `frontend/` shell, workflow steps, invoice viewer, DiffView, API pane, SSE client, store |
| `einvoice-domain-engineer` | Invoice model, decimal handling, presets, UBL/FatturaPA mapping tables + writers/parsers, `uapi-map.ts`, golden fixtures |
| `validation-engineer` | SEF build, Schematron worker, SVRL → findings, FatturaPA rules, `validate.py`, `xml-locate.ts` |
| `backend-engineer` | FastAPI app, settings, recorder/mask/SSE, mock transport, routes, Docker |
| `fiskaly-api-integrator` | `uapi.py`, `workflow.py`, `inbox.py`, spec fetch + type generation, recorded fixtures, round-trip spikes |
| `qa-engineer` | Vitest, Playwright, pytest suites, golden + Schematron fixture tests, CI |
| `compliance-reviewer` | Read-only review of generated XML/labels vs. FatturaPA, Peppol BIS 3.0, EN 16931; legal citations |
| `devops-engineer` | Makefile, `make doctor`, Dockerfiles/compose, `.env.example`, GitHub Actions, Node bootstrap |
| `docs-writer` | README, `docs/DEMO-SCRIPT.md`, glossary, ADR formatting |
