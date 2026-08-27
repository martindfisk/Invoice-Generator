# Architecture Decision Records

This directory records the significant architectural decisions for the Invoice Generator project.

## Format

Each ADR is a single Markdown file named `NNNN-title-in-kebab-case.md`, numbered sequentially starting at `0001`. Once accepted, an ADR is not rewritten to reflect a later decision — a new ADR supersedes it, and the old one's status is updated to `Superseded by NNNN`.

Each ADR has four sections:

- **Status** — `Proposed`, `Accepted`, `Superseded by NNNN`, or `Rejected`.
- **Context** — the problem and constraints that forced a decision.
- **Decision** — what was decided, stated as a plain sentence.
- **Consequences** — what becomes easier or harder as a result, including trade-offs accepted.

## Index

| ADR | Title |
|---|---|
| [0001](0001-dual-track-architecture.md) | Dual-track architecture: client-side generation + UAPI harness, diffed |
| [0002](0002-spec-fetched-at-build-time.md) | UAPI spec fetched at build time from workspace.fiskaly.com |
| [0003](0003-xsd-validation-and-vendored-standards.md) | XSD validation in the backend; standards vendored into git-ignored `vendor/` |
| [0004](0004-schematron-via-saxonjs-sef.md) | Schematron in the browser via SaxonJS + build-time SEF; Peppol rules compiled from `.sch` |
