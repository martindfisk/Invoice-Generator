---
name: project-france-removed
description: France (fr-store presets, CHORUS_PRO channel, FR VAT fallback) was removed 2026-09-01 because fiskaly UAPI has no e-invoice-fr product
metadata:
  type: project
---

France was removed from the app on 2026-09-01: presets `fr-store-b2b-facturx`, `fr-store-b2g-chorus`, `fr-store-b2g-broken`, the "Lyon store (FR)" group, the `CHORUS_PRO` channel value, and the FR row in `FALLBACK_VAT_RATES` (uapi-map.ts).

**Why:** fiskaly's Unified API has no `e-invoice-fr` product (only `it`, `be`, `de` in `spec/`), so the French presets promised a send path the tool could not deliver.

**How to apply:** Do not reintroduce FR presets, a CHORUS_PRO channel, or French code-list entries unless a `spec/fiskaly.uapi.e-invoice-fr.*.yaml` exists. The CII format (Factur-X 1.08 / ZUGFeRD 2.4 EN 16931 profile) stays — `de-hotel-b2b-zugferd` is its native preset; "Factur-X" in labels names the joint FNFE-MPE/FeRD spec, not French support. Coverage for `references.salesOrder` / `despatchAdvice` / `project` (BT-14/16/11), which only the FR presets populated, is pinned via augmented-invoice tests in roundtrip/ubl-write/cii-write/fatturapa-write tests. Known leftovers outside domain ownership at removal time: inert `FR` entries in `StepSetup.tsx` ordering/label maps, a `/^France/` rowheader assertion in `frontend/e2e/smoke.spec.ts` (breaks `make e2e` until QA/frontend updates it), a comment in `uapi-schema-client.ts`; backend tests use `country: "FR"` as the unknown-country negative case, which remains correct.
