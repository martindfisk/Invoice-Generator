SHELL := /bin/bash
.DEFAULT_GOAL := help
ROOT := $(CURDIR)
PY := "$(ROOT)/backend/.venv/bin/python"
PIP := "$(ROOT)/backend/.venv/bin/pip"
NPM := npm --prefix "$(ROOT)/frontend"

.PHONY: help setup doctor node spec gen-types schemas sef dev test e2e lint docker clean

help:
	echo "Targets: setup doctor spec gen-types schemas sef dev test e2e lint docker clean"

node:
	command -v node >/dev/null 2>&1 || brew install node

setup: node spec schemas sef
	cd "$(ROOT)/frontend" && npm install
	[ -x $(PY) ] || python3 -m venv "$(ROOT)/backend/.venv"
	$(PIP) install -q -e "$(ROOT)/backend[dev]"
	$(MAKE) gen-types
	[ -f "$(ROOT)/.env" ] || { cp "$(ROOT)/.env.example" "$(ROOT)/.env"; echo "created .env from .env.example (MOCK mode) — add keys for LIVE"; }

doctor:
	@ok=1; \
	v=$$(node --version 2>/dev/null | tr -d v | cut -d. -f1); if [ -n "$$v" ] && [ "$$v" -ge 20 ]; then echo "node      ok ($$(node --version))"; else echo "node      MISSING (>=20; brew install node)"; ok=0; fi; \
	python3 -c 'import sys; sys.exit(0 if sys.version_info[:2]>=(3,13) else 1)' && echo "python    ok ($$(python3 --version))" || { echo "python    NEEDS 3.13+"; ok=0; }; \
	[ -x $(PY) ] && echo "venv      ok" || { echo "venv      missing (make setup)"; ok=0; }; \
	[ -d "$(ROOT)/frontend/node_modules" ] && echo "node_mods ok" || { echo "node_mods missing (make setup)"; ok=0; }; \
	[ -f "$(ROOT)/spec/version.txt" ] && echo "spec      ok (X-Api-Version $$(cat "$(ROOT)/spec/version.txt"))" || { echo "spec      missing (make spec)"; ok=0; }; \
	[ -f "$(ROOT)/.env" ] && echo ".env      ok" || echo ".env      missing (cp .env.example .env)"; \
	docker info >/dev/null 2>&1 && echo "docker    ok" || echo "docker    not running (optional)"; \
	[ -x "$(ROOT)/.claude/hooks/format.sh" ] && [ -x "$(ROOT)/.claude/hooks/guard.sh" ] && echo "hooks     ok" || { echo "hooks     not executable (chmod +x .claude/hooks/*.sh)"; ok=0; }; \
	python3 "$(ROOT)/tools/check_env_example.py" 2>/dev/null || true; \
	[ $$ok = 1 ]

spec:
	python3 "$(ROOT)/tools/fetch_spec.py"

gen-types:
	cd "$(ROOT)/frontend" && npm run gen-types

schemas:
	python3 "$(ROOT)/tools/fetch_assets.py"

sef:
	cd "$(ROOT)/frontend" && node scripts/build-sef.mjs

dev:
	@trap 'kill 0' EXIT INT TERM; \
	(cd "$(ROOT)/backend" && .venv/bin/uvicorn app.main:app --reload --port 8000) & \
	(cd "$(ROOT)/frontend" && npm run dev) & \
	wait

test:
	cd "$(ROOT)/backend" && .venv/bin/pytest -q
	cd "$(ROOT)/frontend" && npm test

e2e:
	cd "$(ROOT)/frontend" && npm run test:e2e

lint:
	cd "$(ROOT)/backend" && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd "$(ROOT)/frontend" && npm run lint && npm run typecheck && npx prettier --check "src/**/*.{ts,tsx,css}" "tests/**/*.ts" "scripts/*.mjs"

docker:
	docker compose up --build

clean:
	rm -rf "$(ROOT)/frontend/dist" "$(ROOT)/frontend/node_modules" "$(ROOT)/backend/.venv" "$(ROOT)/frontend/src/gen"
