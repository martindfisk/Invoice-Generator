# 0007. Schematron runs on the main thread; four SEFs ship

## Status

Accepted, 2026-09-03. Amends [ADR-0004](0004-schematron-via-saxonjs-sef.md) on three points; everything else in ADR-0004 (compile to SEF at build time, never compile `.sch` at runtime, no sidecar, pinned sources) stands.

## Context

ADR-0004 decided to "run SaxonJS 2 in a lazily-loaded Web Worker" and left the SaxonJS browser-runtime redistribution terms unresolved. Implementation found both statements overtaken:

1. **The SaxonJS 2.7 browser runtime (`SaxonJS2.rt.js`) cannot load in a Web Worker.** Its bootstrap touches `document` at load time, which a worker scope does not have. The module kept the `schematron.worker.ts` name but runs `SaxonJS.transform` on the main thread; the file's own header documents this.
2. **The runtime was vendored anyway** (`make sef` fetches it into `public/saxon/`, pinned in `frontend/public/sef/SOURCES.md`), so the "must be settled before the stage ships" question was settled by shipping — this ADR records the resolution: Saxonica distributes `SaxonJS2.rt.js` free of charge for use with SaxonJS applications; it is fetched at build time and git-ignored, never redistributed from this repository.
3. **Six SEFs were being built and shipped, two of them unreachable.** `en16931-ubl` and `xrechnung-cii` carried an empty `formats` list in `tools/rulesets.json`, so `resolveRuleSets` could never load them — ~8.5 MB of dead payload in `public/sef/` and the Docker image.

## Decision

- **Main thread, mitigated, until SaxonJS can run in a worker.** The parsed SEF is cached (LRU of 3, ~all a session needs), so the multi-megabyte JSON parse is paid once per rule set, not per validation run; validation runs are debounced and cancellable (`AbortSignal`), so superseded runs stop between stages. Revisit if SaxonJS ships worker support or if a WASM XSLT 2.0 engine becomes viable.
- **Four SEFs ship**: `cen-ubl` + `peppol-ubl` (UBL), `cen-ubl` + `xrechnung-ubl` (XRechnung), `en16931-cii` (CII). `en16931-ubl` and `xrechnung-cii` were removed from `tools/rulesets.json` (2026-09-03); the `BR-*` unit-fixture tests run against `cen-ubl`, which carries the same CEN rules.

## Consequences

- A Schematron pass still blocks the UI for the transform duration (~11–40 ms warm, one-off SEF parse cold). Acceptable for a demo tool; the mitigation list above is the ceiling without engine changes.
- `frontend/public/sef/` drops from ~25 MB to ~16.8 MB raw (433 kB gzip total).
- The misleadingly named `schematron.worker.ts` keeps its name deliberately — renaming it breaks no promise the code still makes, and its header explains the history; rename opportunistically on the next structural change.
