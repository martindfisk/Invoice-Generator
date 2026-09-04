# The Invoice Generator Handbook

How the invoices work, how the mappings work, how the app works — the layers, the mechanics, and
the reasoning behind them. The terse map lives in [docs/ARCHITECTURE.md](../ARCHITECTURE.md); this
handbook is the full explanation. One invoice threads the whole book as a running example: the
**Italian B2B (SDI)** preset (`it-b2b-sdi`).

## Chapters

| #   | Chapter                                               | What it answers                                                                            |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 01  | [Overview & layers](01-overview.md)                   | What the app is, the dual-track idea, how the layers fit together                          |
| 02  | [The invoice model](02-invoice-model.md)              | The canonical `Invoice`, decimal money, field addressing, presets, EN 16931 grounding      |
| 03  | [Mappings](03-mappings.md)                            | How one model becomes four XML formats and one JSON operation; lossiness; field fates      |
| 04  | [Mapping reference](04-mapping-reference.md)          | _Generated._ Every mapping row, loss table and fate entry, straight from the code          |
| 05  | [The Mapper](05-mapper.md)                            | The three panes, two-way editing, selection & cross-highlighting, spec coverage, app state |
| 06  | [Validation](06-validation.md)                        | The six-stage pipeline: engines, where each runs, findings, known engine defects           |
| 07  | [Send & the backend](07-send-and-backend.md)          | The send lifecycle, corrections, the FastAPI proxy, the call recorder, the mock            |
| 08  | [Infrastructure](08-infrastructure.md)                | Spec-at-build, vendored standards, SEF compilation, Docker, CI                             |
| 09  | [What the tool knows it cannot do](09-limitations.md) | Fates, lossy edits, the gap report, known defects, the MOCK caveat — the honesty machinery |
| 10  | [Screen-by-screen tour](10-tour.md)                   | Every screen, control and badge, in order                                                  |

## Reading paths

- **New developer on this repo** — 01 → 02 → 03 → 05 → 06 → 07 → 08; keep 04 open as a lookup.
- **Integrator learning the fiskaly Unified API** — 01 → 03 (the JSON operation section) → 04 →
  09 → 07 (choreography); the app itself is the interactive companion.
- **SE / demo presenter** — 10 → 01 → 09, then [docs/DEMO-SCRIPT.md](../DEMO-SCRIPT.md) for the
  scripted choreography.
- **Learning e-invoicing through the app** — 02 → 03 → 06; the BT/BG ids and legal bases are cited
  where they carry weight.

## Conventions used throughout

- **Money is a decimal string**, never a float — `"1500.00"`, not `1500`. See
  [02](02-invoice-model.md#decimal-money).
- **BT-x / BG-x** are EN 16931 business terms/groups; **FPA paths** are FatturaPA blocks
  (specs 1.9.1); **`{i}`** marks a repeating group.
- **The spec is the contract** (`spec/*.yaml`, currently `2026-06-01`); captures and fixtures are
  observations. When the two disagree, both are recorded — the disagreement is the interesting
  part.
- File references are repo-relative; the code is always the final authority.

## Keeping it truthful

Chapter 04 is generated from the mapping data the writers themselves consume: `make handbook`
regenerates it, `make handbook-check` fails CI when it is stale. The prose chapters are reviewed by
hand; when you change a mechanism, change its chapter in the same PR.
