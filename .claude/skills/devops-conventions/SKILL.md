---
name: devops-conventions
description: Makefile targets, environment variables, local dev orchestration, Docker/nginx (SSE) and CI conventions for the Invoice Generator. Load when touching Makefile, Dockerfiles, compose, CI or .env.example.
---

# DevOps conventions

- Repo path contains a space — quote `$(CURDIR)` and paths in every recipe/script.
- **Make targets** (names are a contract with README): `setup` (Node via Homebrew if absent → `npm ci|install` in `frontend/` → `backend/.venv` + `pip install -e '.[dev]'` → `spec` → `gen-types`), `doctor` (node ≥ 20, python 3.13, docker optional, `.env` present, `spec/version.txt`, hooks executable; runs `spec-check`), `spec` (`python3 tools/fetch_spec.py`; `--frozen` verifies without downloading), `spec-check`, `gen-types`, `schemas` (`python3 tools/fetch_assets.py` → `vendor/`), `sef` / `sef-check` (build/verify SEF), `gap-report` / `gap-check` (docs/gaps), `handbook` / `handbook-check` (generated mapping reference), `dev` (uvicorn :8000 + vite :5173 in one terminal, both killed on Ctrl-C), `test` (pytest + vitest), `e2e` (Playwright, starts servers in MOCK), `lint` (ruff, eslint, prettier --check, tsc), `docker` (compose build + up).
- **Env vars** live only in `.env` (git-ignored) documented by `.env.example`; `settings.py` and `.env.example` must list the same names — `doctor` diffs them.
- **Local-first**: no Docker needed for `make dev`. Docker is the hosting seam: `Dockerfile.backend` (python:3.13-slim, non-root, `uvicorn`), `Dockerfile.frontend` (node build stage → nginx serving `dist/`, `docker/nginx.conf` proxies `/api/` to `backend:8000` with `proxy_buffering off; proxy_read_timeout 3600s; proxy_http_version 1.1;` for SSE), `docker-compose.yml` wiring both and reading `.env`.
- **CI** (`.github/workflows/ci.yml`): on push/PR — setup Python 3.13 + Node, deps, `python3 tools/fetch_spec.py --frozen` (verify the committed spec, download nothing), `make schemas`, `make sef`, `gen-types`, `make lint`, the staleness gates (`spec-check`, `sef-check`, `gap-check`, `handbook-check`), `make test`, then Playwright browsers + `make e2e` in MOCK; no secrets; Playwright report as artifact on failure.
- **Dependencies**: justify every addition in the report; keep licence notes (SaxonJS free-proprietary, CEN EUPL-1.2, Peppol rules OpenPeppol) in `docs/ARCHITECTURE.md`.
