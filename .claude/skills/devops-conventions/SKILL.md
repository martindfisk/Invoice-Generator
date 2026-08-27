---
name: devops-conventions
description: Makefile targets, environment variables, local dev orchestration, Docker/nginx (SSE) and CI conventions for the Invoice Generator. Load when touching Makefile, Dockerfiles, compose, CI or .env.example.
---

# DevOps conventions

- Repo path contains a space — quote `$(CURDIR)` and paths in every recipe/script.
- **Make targets** (names are a contract with README): `setup` (Node via Homebrew if absent → `npm ci|install` in `frontend/` → `backend/.venv` + `pip install -e '.[dev]'` → `spec` → `gen-types`), `doctor` (node ≥ 20, python 3.13, docker optional, `.env` present, `spec/version.txt`, hooks executable), `spec` (`python3 tools/fetch_spec.py`), `gen-types`, `schemas` (`python3 tools/fetch_assets.py` → `vendor/`), `sef` (build-sef), `dev` (uvicorn :8000 + vite :5173 in one terminal, both killed on Ctrl-C), `test` (pytest + vitest), `e2e` (Playwright, starts servers in MOCK), `lint` (ruff, eslint, prettier --check, tsc), `docker` (compose build + up).
- **Env vars** live only in `.env` (git-ignored) documented by `.env.example`; `settings.py` and `.env.example` must list the same names — `doctor` diffs them.
- **Local-first**: no Docker needed for `make dev`. Docker is the hosting seam: `Dockerfile.backend` (python:3.13-slim, non-root, `uvicorn`), `Dockerfile.frontend` (node build stage → nginx serving `dist/`, `docker/nginx.conf` proxies `/api/` to `backend:8000` with `proxy_buffering off; proxy_read_timeout 3600s; proxy_http_version 1.1;` for SSE), `docker-compose.yml` wiring both and reading `.env`.
- **CI** (`.github/workflows/ci.yml`): on push/PR — setup Python 3.13 + Node 22, `make lint`, `make test`, `make e2e` in MOCK; cache pip/npm; no secrets; artifacts: Playwright report on failure.
- **Dependencies**: justify every addition in the report; keep licence notes (SaxonJS free-proprietary, CEN EUPL-1.2, Peppol rules OpenPeppol) in `docs/ARCHITECTURE.md`.
