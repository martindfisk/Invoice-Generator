# 0006. Drop-in OpenAPI spec, and field metadata served from it

## Status

Accepted — 2026-09-02. Amends [ADR-0002](0002-spec-fetched-at-build-time.md).

## Context

Two problems arrived together.

**The spec was only obtainable from the network.** `tools/fetch_spec.py` discovered spec URLs from
`products.json` and constructed filenames as `fiskaly.uapi.e-invoice-{cc}.{version}.yaml`; every
consumer then globbed that exact shape. When an all-products spec
(`fiskaly.unified-api.all.2026-06-01.yaml`) was handed over by hand, there was nowhere to put it: it
matched no consumer's glob, and it is **not published** — `products.json` lists only
`fiskaly.uapi.e-invoice-{it,be,de}` and the `sign-*` specs, and
`GET .../fiskaly.unified-api.all.2026-06-01.yaml` answers `301` then `404`. So a hand-delivered spec
was the only acquisition path for it, and the repo had no such path.

**The Compose step under-reported the API.** It presents the `TRANSACTION::INVOICE` JSON as *the*
artifact, but `uapi-map.ts` emits only the pointers we happened to implement — measured at 58 distinct
templated leaf pointers for the richest preset, against roughly 118 applicable for the variants that
invoice already uses. A field the API accepts but we never wired was simply invisible, exactly where
the tool claims to document the API.

Measurement settled what the new file is worth. It adds **zero fields**: 634 `components.schemas` in
both it and the per-country specs, identical names, and the 226-schema `InvoiceTransaction` closure is
structurally identical once `description`/`summary`/`title` are stripped. Its value is **prose** —
154,852 characters of descriptions against 61,039, including **134** schema descriptions carrying
per-country applicability blocks (`🇮🇹 **Italy (IT_EI):** …`, `🇩🇪 **Germany (DE_EI):** Not required`).
The per-country specs contain **zero** profile codes. It is therefore the only machine-readable source
for which fields matter per country, covering exactly the three the app supports.

## Decision

**A spec dropped into `spec/drop/` is the authority; the network fetch remains the fallback.**

- `tools/fetch_spec.py` gained `ingest_drop()`: exactly one `*.y{a}ml` in `spec/drop/`, identified **by
  content** — `info.version` and `info.title` read from the document head, not from the filename —
  canonicalised to `fiskaly.unified-api.all.<version>.yaml` and **moved** into `spec/`. An empty
  `spec/drop/` is therefore the unambiguous "consumed" signal. `info.title` must contain
  `Unified API`, so dropping a per-country spec fails loudly instead of quietly becoming the authority.
- `refresh()` still fetches the per-country specs and Postman pairs, so `make spec` never regresses and
  a fresh clone still works with no dropped file.
- **`spec/spec.json`** is the new provenance manifest — `{generatedAt, apiVersion, spec, fallback[],
  collections[]}` with a sha256 per file — mirroring `frontend/public/sef/manifest.json`. Cleanup is
  manifest-driven: only files listed in the *previous* manifest and absent from the new one are
  unlinked, so a file the tooling never knew about is never deleted. `version.txt` is still written, so
  `settings.default_api_version()` and `Dockerfile.backend` keep working unchanged.
- **`tools/spec_check.py`** (`make spec-check`, wired into `make doctor` and CI) fails on a missing
  manifest, a sha mismatch, `version.txt ≠ apiVersion`, a stray `*.yaml` in `spec/`, a **non-empty
  `spec/drop/`**, and — under `--types` — generated types older than the active spec. The `--types`
  split exists because `make gen-types` is what *fixes* type staleness, so gating it on the full check
  would deadlock.
- `tools/` stays **stdlib-only**: `make setup` runs `spec` before the backend venv exists, so ingestion
  cannot import pyyaml. Discovery-by-content uses the head regexes `check_openapi()` already had. Full
  YAML parsing lives in `backend/app/`, where pyyaml is a declared dependency.

**Field metadata is extracted from the active spec and served to the browser** at
`GET /api/spec/fields`, so the Compose step measures coverage against the OAS instead of a hand-kept
list.

- **Not** under `/api/uapi/`: `routes.py` declares `@router.api_route("/uapi/{path:path}")`, a catch-all
  proxy to `test.api.fiskaly.com`. Starlette matches in declaration order, so `/api/uapi/fields` would
  be forwarded upstream as a real API call and logged as though we had made one. A guard test asserts
  the only `/api/uapi*` route is the passthrough.
- Computed at startup and memoised on `app.state` (0.24 s parse, 5 ms walk), reusing the
  `warm_schemas` → `asyncio.to_thread` idiom. `ETag` keyed on the spec's sha256, the way
  `schematron.worker.ts` keys on `sef.sha256`. Deliberately not a build artifact: this is not a browser
  asset, and the backend already parses the file.

## Consequences

- Upgrading to a new major version is `cp <spec>.yaml spec/drop/ && make spec` — no code edit, no
  filename convention to honour. `make doctor` reports a spec sitting un-ingested.
- The spec is identified by its content, so a renamed file still ingests correctly and a
  wrongly-named one cannot masquerade as a version it is not.
- **Two spec sources coexist**, which is the accepted cost of not losing the network path. The manifest
  records which is active, and `/api/config` reports it, so "which spec am I running, and did someone
  hand-drop it" is always answerable.
- Per-country applicability is only available while an annotated all-products spec is active. Under the
  fetched fallback the endpoint emits `{status: "unknown"}` plus a warning; it **never** substitutes one
  country's verdicts for another's. A test asserts the DE_EI verdict vector differs from IT_EI, so a
  silent fallback fails the build.
- Parsing applicability out of prose depends on an undocumented convention. A test asserting all 134
  annotated descriptions still yield at least two parsed blocks turns a syntax change into a red build
  rather than silently empty metadata; un-annotated fields default to `applicable`, which errs towards
  showing a field rather than hiding it.
- `additionalProperties: false` on 70 closure schemas means the pointer inventory is exhaustive by
  construction — no extra key is ever accepted — so a coverage figure derived from it is a real
  denominator rather than a guess.
