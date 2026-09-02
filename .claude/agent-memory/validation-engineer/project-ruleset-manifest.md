---
name: project-ruleset-manifest
description: tools/rulesets.json is the single pin manifest (2026-09-02); --update workflow, manifest.json contract, and the non-obvious gotchas
metadata:
  type: project
---

Since 2026-09-02, all XSD/XSLT/Schematron/SaxonJS pins live in `tools/rulesets.json` (sources[] + ruleSets[]), consumed by both `tools/fetch_assets.py` and `frontend/scripts/build-sef.mjs`. Bump workflow: `python3 tools/fetch_assets.py --update <source>=<version>` → `make schemas && make sef` → `npm run schematron:expected` (milestone 4) → commit manifest + test expectations together.

**Why:** plan `create-a-plan-for-structured-shamir.md` — bumping pins used to require hand-editing Python constants; CEN 1.3.16 exists but the repo deliberately stays on 1.3.15 until the goldens diff is reviewed.

**How to apply:**

- `frontend/public/sef/manifest.json` shape is a fixed contract consumed by `schematron-sets.ts` / the worker (cache keyed by `sef.sha256`). Do not rename its fields.
- `--update` refuses on a git-dirty rulesets.json and when no file hash changed while the version moved (per-file unchanged hashes under a changed URL only warn, so an unchanged LICENSE inside a new zip does not block a bump).
- `STANDARDS_DIRS` (env or .env, os.pathsep-separated) x `localSubdirs` replaces the old hardcoded `/Users/martin.dutzler/...` roots; local files are an optimisation only — pins always verified.
- xrechnung source has `vars.cius` (3.0.2) and a bundle date baked into `localSubdirs`; the peppol source `title` carries a "(2025 November release)" parenthetical — both need a manual edit on bump, `--update` only rewrites version/shas/fetchedAt.
- `frontend/public/sef/*.sef.json` are git-ignored and rebuilt in CI; `SOURCES.md` next to them IS committed, so it can be stale output of an older script revision (the 2026-08 skos:prefLabel markup leak was exactly that — the regexes had already been fixed). build-sef now does a real XML read via SaxonJS XPath and asserts extracted metadata contains no `<>"`.
- `make sef-check` (also in `make doctor` and CI before tests) compares each SEF's embedded `buildDateTime` against vendored-source and rulesets.json mtimes and the installed saxon-js major, and checks manifest.json sha freshness.
- tools/ modules are importable in backend tests via a sys.path insert in `backend/tests/conftest.py`; tests live in `backend/tests/test_rulesets.py`.
- vendor/ byte-identity check: `find vendor -type f ! -name SOURCES.md | sort | xargs shasum -a 256` — SOURCES.md itself embeds a timestamp and fetched date, so it can never be byte-stable.
