# 0004. Schematron in the browser via SaxonJS and build-time SEF

## Status

Accepted — outcome of M1 spike (b), 2026-08-26. **Amended by [ADR-0007](0007-schematron-on-the-main-thread.md)** (2026-09-03): SaxonJS runs on the main thread, not in a Web Worker; four SEFs ship, not three; the SaxonJS runtime licence question is resolved.

## Context

EN 16931 and Peppol BIS Billing 3.0 business rules ship as Schematron. The artefacts declare `queryBinding="xslt2"` and embed `xsl:function` blocks (`u:gln`, `u:mod11`, `u:checkPIVA`, …), which rules out the pure-JavaScript Schematron runners: `node-schematron` and `schematron-runner` implement minimal syntax only and cannot execute those stylesheets. The realistic options were SaxonJS in the browser, or a Saxon-HE (JVM) sidecar behind an API endpoint — which would break the "runs in the browser" premise and add a container to a local-first tool.

## Decision

**Compile to SEF at build time; run SaxonJS 2 in a lazily-loaded Web Worker.** `make sef` (`frontend/scripts/build-sef.mjs`) invokes the free `xslt3` Node compiler — no Saxon-EE licence is involved. Schematron is **never** compiled at runtime.

Three SEFs are produced, because the rule sets genuinely differ:

| SEF           | Source                                             | Raw     | Gzip   |
| ------------- | -------------------------------------------------- | ------- | ------ |
| `en16931-ubl` | CEN 1.3.15 precompiled XSLT                        | 6.83 MB | 157 kB |
| `peppol-ubl`  | Peppol BIS 3.0.20 `PEPPOL-EN16931-UBL.sch`         | 1.86 MB | 64 kB  |
| `cen-ubl`     | `CEN-EN16931-UBL.sch` as shipped inside BIS 3.0.20 | 8.23 MB | 174 kB |

The browser loads **`cen-ubl` + `peppol-ubl`** — the pair a real Peppol access point applies. `en16931-ubl` is kept for plain EN 16931 checks and the `BR-*` unit-fixture regression tests, not shipped by default.

**Peppol rules are compiled from `.sch`, not downloaded as XSLT**, because `OpenPEPPOL/peppol-bis-invoice-3` ships `rules/sch/` only — `rules/xslt/` exists in no tag and nowhere in its history, and `v3.0.20` publishes no release assets. Compilation uses the official ISO Schematron skeleton (`Schematron/schematron`, MIT, pinned commit) vendored into `vendor/schematron/`.

**SEF output is git-ignored.** 19 MB that embeds a `buildDateTime` and therefore churns on every rebuild does not belong in git; `make setup` and CI run `make sef`. The pinned source sha256 hashes in `vendor/SOURCES.md` and `frontend/public/sef/SOURCES.md` are the meaningful provenance record, and `SOURCES.md` stays committed.

## Alternatives considered

- **Saxon-HE sidecar container.** Rejected — measured cost does not justify it (see below), and it would make a local-first demo depend on a JVM container.
- **`node-schematron` / `schematron-runner`.** Rejected — minimal-syntax only; the official artefacts' `xsl:function` blocks would not execute.
- **`phax/phive-rules` precompiled Peppol XSLT.** Rejected — a third-party compilation whose per-release folders contain only _changed_ files, making version pinning fragile.

## Consequences

- **Browser-viable, measured not assumed.** Worst realistic payload is ~400 kB gzipped (`cen-ubl` 174 + `peppol-ubl` 64 + SaxonJS browser runtime 162), lazily fetched on first validation; warm transforms then run in ~11–40 ms. Re-reading a SEF from disk costs 110–165 ms, so the worker must cache the parsed SEF.
- **Proven, not hoped**: 18/18 smoke checks pass — SaxonJS executes all three stylesheets (SVRL output, 46–65 fired rules, zero failed asserts on `BIS3_Invoice_positive`), and each `BR-16` / `BR-CO-15` / `BR-S-08` fixture fires exactly its own rule in the error case and not in the success case.
- `xml-locate.ts` must normalise Saxon's `@location` form — every step is `*:Name[namespace-uri()='…'][n]`, always positional, no attribute steps — into the project's prefixed path form.
- **A new vendored dependency**: the ISO Schematron skeleton (4 files, 187 kB, MIT).
- `iso_dsdl_include.xsl` overflows the SaxonJS stack on the 310 kB `CEN-EN16931-UBL.sch`. Both vendored rule sets are already flat, so `build-sef.mjs` runs each preprocessing step only when the schema actually uses `<include>`/`<extends>`/abstract patterns. A future rule set needing includes will hit this and require `node --stack-size`.
- **Unresolved**: `saxon-js` on npm is the Node build (`SaxonJS2N.js`, depends on `axios`/`fs`). The browser needs `SaxonJS2.rt.js`, distributed by Saxonica outside npm. Vendoring it, and its free-but-proprietary redistribution terms, is a licence question that must be settled before the Schematron stage ships in the browser.
- Pinned at CEN **1.3.15** to match the vendored artefacts; **1.3.16** (2026-04-13) exists and should be a deliberate bump.
