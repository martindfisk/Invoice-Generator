# 0003. XSD validation in the backend, standards vendored into `vendor/`

## Status

Accepted — outcome of M1 spike (c), 2026-08-26.

## Context

The validation pipeline needs XSD validation for Peppol BIS 3.0 UBL 2.1 and FatturaPA. Two questions had to be settled before building on it: **where** XSD validation runs (browser WASM vs. the backend proxy), and **where the schema artefacts come from**, given that none of them may be committed to this repository without licence review.

`libxml2-wasm` was the browser candidate, but UBL 2.1's schema set is heavily `xsd:import`-based (a `maindoc` document importing 14 `common` schemas) and import resolution is exactly the area that library marks experimental. The backend proxy already exists for credential handling, so an lxml-based endpoint costs no new infrastructure.

## Decision

**XSD validation runs in the backend** via `lxml.etree.XMLSchema`, behind `POST /api/validate/xsd`. The frontend calls it through `xsd-client.ts`, which keeps the seam so a WASM implementation can replace it later without touching callers.

**Standards artefacts are vendored at setup time**, never committed: `tools/fetch_assets.py` (`make schemas`, stdlib only, sha256-pinned, idempotent) populates a git-ignored repo-root `vendor/` and writes `vendor/SOURCES.md` recording source, licence and hash per file. `Settings.vendor_dir` (`VENDOR_DIR`) points at it; the validator raises `FileNotFoundError("… run: make schemas")` when it is absent, and the test suite skips with that same reason rather than failing.

Sources settled by the spike:

| Artefact                                         | Source                                                                                                                                 | Licence                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| UBL 2.1 (`maindoc` + 14 `common`)                | Local XRechnung 3.0.2 validator bundle, verified **byte-identical** to the OASIS `xsdrt` package; OASIS URLs are the download fallback | OASIS                                                 |
| FatturaPA **1.2.3** (`Schema_VFPR12_v1.2.3.xsd`) | `fatturapa.gov.it/export/documenti/fatturapa/v1.4/`                                                                                    | AdE, all rights reserved (personal-storage carve-out) |
| `xmldsig-core-schema.xsd`                        | W3C REC-xmldsig-core-20020212                                                                                                          | W3C                                                   |
| Fallback FatturaPA **1.2.2**                     | `invopop/gobl.fatturapa`                                                                                                               | Apache-2.0                                            |

## Alternatives considered

- **`libxml2-wasm` in the browser.** Rejected for now — experimental `xsd:import` support against the schema set that depends on it most. Revisit if we ever want fully offline validation; the `xsd-client.ts` seam exists for that.
- **Committing the XSDs.** Rejected — fatturapa.gov.it is "ogni diritto riservato" and permits personal storage, not redistribution. Vendoring into a git-ignored directory at setup time respects that; committing would not.
- **Downloading the 57.9 MB `UBL-2.1.zip`.** Rejected — the 16 needed files are fetched individually from the same OASIS tree (0.6 MB), byte-identical under the pinned hashes.

## Consequences

- A working tree needs `make schemas` before XSD validation or its tests do anything; `make setup` runs it, and CI runs it as its own step.
- **Official FatturaPA example invoices are not redistributed.** Synthetic TD01 examples are generated instead, which is why fixtures carry a synthetic marker. Should we decide the personal-storage carve-out covers vendored examples too, `tools/fetch_assets.py` can add the fetch — this is a licence judgement, not a technical blocker.
- When fatturapa.gov.it is unreachable the fallback yields schema **1.2.2**, which lacks TD29 and RF20. The vendor directory self-heals to 1.2.3 on the next successful run, and `SOURCES.md` always records which was used — so a validation surprise is traceable rather than silent.
- Measured latency makes the backend hop a non-issue: warm XSD validation is 0.04 ms (FatturaPA) and 0.19 ms (UBL); end-to-end through the route, 0.27 ms / 0.48 ms. No thread offloading needed.
- The UBL import graph is proven, not assumed: the CEN `ubl-tc434-example1.xml` and `ubl-tc434-creditnote1.xml` fixtures (EUPL-1.2, attributed in their own directory) validate against the vendored graph in CI.
