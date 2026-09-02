# 0002. UAPI spec fetched at build time

## Status

Accepted. Amended 2026-09-02 by [ADR-0006](0006-drop-in-spec-and-field-metadata.md),
which adds `spec/drop/` and makes a hand-dropped spec take precedence over the fetched ones.

## Context

The tool depends on the fiskaly Unified API's OpenAPI spec for generated TypeScript types, the current `X-Api-Version` value, and fixture-contract validation. The spec evolves — releases 5.0–5.5 added IT SDI send, SDI/Peppol reception, artifact retrieval, and Peppol BIS for DE without bumping the `X-Api-Version` header — and `developer.fiskaly.com` is deprecated in favour of `workspace.fiskaly.com`. Two internal shortcuts were considered instead of fetching from the public spec: the `bodex` spec/Postman snapshot pinned at `2026-05-04`, and the generated types already vendored in `meta`.

## Decision

Fetch the latest public spec at build time from `workspace.fiskaly.com`: `tools/fetch_spec.py` discovers spec URLs via `products.json`, picks the latest CalVer per product for `e-invoice-it`, `e-invoice-be` and `e-invoice-de`, and downloads specs and Postman collections into a **committed cache** in `spec/`. If the network is unavailable, the fetch falls back to the committed cache with a loud warning; without a cache it errors instead of continuing silently. The header value the tool sends is read from `spec/version.txt`, and as of today that value is strictly `2026-06-01`.

## Alternatives considered

- **Pin the `bodex` `2026-05-04` spec/Postman snapshot.** Rejected — verified to be a v4 shape (`document.total_vat`, scalar `unit.price`), not the v5 `InvoiceTransaction` shape (`totals.vat{amount, exclusive, inclusive}`, discriminated `breakdown[]`, `unit.price{inclusive, exclusive}`) that the live API actually requires. Copying it would silently build against the wrong contract.
- **Copy the generated types from `meta` (`meta/.../generated.d.ts`).** Rejected — unusable in the frontend as-is: nominal `declare enum`s don't structurally match plain string literals from `JSON.parse`, and it exports a `Record` type that shadows TypeScript's built-in `Record`.

## Consequences

- Types are generated from whichever spec `spec/spec.json` records as active — the dropped all-products spec when present, otherwise the fetched IT spec; generated types are git-ignored, not committed — only the raw spec files in `spec/` are.
- The three per-country specs were expected to differ, with IT a superset of BE. Measured on 2026-09-02 they do not: all three carry the same 634 `components.schemas` by name, and the 226-schema `InvoiceTransaction` closure is structurally identical across IT, BE and DE — `InvoiceTransaction` itself is byte-identical. The drift test this ADR originally promised was never written; the property it would have asserted holds, and `backend/tests/test_fields.py` now pins the closure's shape instead.
- `make spec` must run (and is called by `make setup`) before the first build; offline contributors rely on whatever is already committed in `spec/`, which can lag the live API.
- The backend's default `X-Api-Version` tracks `spec/version.txt` rather than being hardcoded, so an unsupported-version error from fiskaly surfaces loudly instead of failing silently.
