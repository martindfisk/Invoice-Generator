# 08 — Infrastructure

Three build-time pipelines keep the app truthful — the API spec, the standards artifacts, and the
compiled Schematron — plus the Docker packaging and the CI gates that stop any of them from
drifting.

## The spec, fetched at build time (ADR-0002, ADR-0006)

`spec/` is a **committed cache** of the UAPI OpenAPI documents and Postman collections, and the
single API authority for the whole repo. `tools/fetch_spec.py` (stdlib only) resolves it two ways:

- **Drop-in wins**: a YAML placed in `spec/drop/` is identified _by content_ (`info.version`,
  `info.title` — the filename is not trusted), renamed canonically and moved into `spec/`; an empty
  `spec/drop/` means "consumed". This is how the currently active all-countries spec
  (`fiskaly.unified-api.all.2026-06-01.yaml`) arrived.
- Otherwise the per-country specs (IT, BE, DE) and collections are fetched from
  `workspace.fiskaly.com` at the latest CalVer.

`spec/spec.json` records the active spec, the fallbacks and a sha256 per file; `spec/version.txt`
carries the `X-Api-Version` the backend sends. Downstream consumers, all keyed on this one source:

| Consumer                             | Mechanism                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Frontend types (`src/gen/uapi.d.ts`) | `openapi-typescript` via `npm run gen-types`                                                                  |
| Contract validation stage            | backend compiles `components.schemas.InvoiceTransaction` to JSON Schema Draft 2020-12                         |
| Spec-coverage field catalogue        | backend walks the schema closure into `{i}`-templated pointers with constraints and per-country applicability |
| Mock fixtures                        | validated against `components.schemas` with `jsonschema` in the test suite                                    |
| Test runner                          | the committed Postman collections, parsed by `collections.py`                                                 |

`make spec` refreshes; `make spec-check` (in `make doctor` and CI) fails on a stale, tampered or
un-ingested `spec/`.

## Vendored standards (`make schemas`, ADR-0003)

`tools/fetch_assets.py` downloads the standards artifacts — OASIS UBL 2.1 XSDs, the FatturaPA XSD,
CEN EN 16931 Schematron/XSLT 1.3.15, Peppol BIS 3.0.20 `.sch`, KoSIT XRechnung 2.5.0, the ISO
Schematron skeleton, the SaxonJS runtime — into a git-ignored `vendor/`, every file pinned by
sha256 in `tools/rulesets.json`. Git-ignored is deliberate licensing posture, not laziness: the
FatturaPA XSD permits _local personal-use storage only_, so each machine fetches its own copy from
the official source; `vendor/SOURCES.md` records provenance and licence per file. Offline
environments can satisfy the pins from a local bundle via `STANDARDS_DIRS`.

## Schematron SEFs (`make sef`, ADR-0004 + ADR-0007)

Schematron is **never compiled at runtime**. `frontend/scripts/build-sef.mjs` compiles the vendored
rule sets to SaxonJS SEF JSON at build time (the free `xslt3` compiler; Peppol ships `.sch` only,
so the ISO skeleton preprocessing runs where needed). Four SEFs ship — `cen-ubl`, `peppol-ubl`,
`xrechnung-ubl`, `en16931-cii` (~17 MB raw, ~430 kB gzip) — plus the SaxonJS browser runtime with
its licence file, into git-ignored `frontend/public/{sef,saxon}/`. A committed
`manifest.json`/`SOURCES.md` pair records versions and hashes; `make sef-check` fails when the SEFs
are stale against the pinned sources. SaxonJS 2.7 cannot load in a Web Worker, so the transform
runs on the main thread with the parsed SEF LRU-cached (ADR-0007).

## Docker: clone-and-run

`docker compose up --build` from a clean clone is the supported way to hand the app to someone
(Docker Desktop is the only prerequisite, macOS/Windows/Linux):

- Both Dockerfiles carry an `assets` build stage that runs `fetch_assets.py` **inside the build**,
  and the frontend stage compiles the SEFs in-image — no host-side `make`/Node/Python, no
  git-ignored inputs, and the licence-restricted artifacts are fetched to the builder's own machine.
- `.dockerignore` excludes any host-built `vendor/`/SEF copies so a stale local build can never
  shadow the in-image one.
- Compose treats `.env` as optional (a clean clone boots straight into MOCK), gives the backend a
  healthcheck the frontend waits on, and publishes **8080** (nginx: static app + `/api` proxy with
  SSE-safe settings) and **8000** (backend, for direct curl).

For development, `make setup` / `make dev` run everything natively (Vite :5173 with an `/api`
proxy, uvicorn :8000, hot reload).

## CI (`.github/workflows/ci.yml`)

One job, every push and PR, `UAPI_MODE=mock`: dependencies → spec fetch → `make schemas` →
`make sef` → type generation → `make lint` (ruff + eslint + tsc + prettier) → the staleness gates
(`spec-check`, `sef-check`, `gap-check`, `handbook-check`) → `make test` (pytest + Vitest) →
Playwright e2e against MOCK. The gates are the theme: anything generated (types, SEFs, the gap
report, the handbook's mapping reference) fails CI when it no longer matches its source.

Last chapter of the mechanics: what the tool deliberately admits it cannot do —
[09 — Limitations](09-limitations.md).
