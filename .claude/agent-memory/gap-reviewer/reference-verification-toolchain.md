---
name: verification-toolchain
description: Practical tooling notes for verifying gap-report rows (YAML parsing, grep targets, row id format)
metadata:
  type: reference
---

System python3 has no `yaml` module; parse `spec/*.yaml` with `backend/.venv/bin/python` instead.

Fast verification targets for gap rows:

- Row ids are `format|field|missingFrom`; severity derivation rules R1-R4 are in `docs/gaps/README.md`.
- Operation-loss reasons live verbatim in `frontend/src/uapi-map.ts` (`UAPI_LOSSY_FIELDS` ~line 619); syntax rendering in `frontend/src/{ubl,cii,fatturapa,xrechnung}-map.ts`.
- `vendor/schematron/CEN-EN16931-UBL.sch`: mandatory buyer content is only BR-07 (BT-44) and BR-10 (BG-8); the UBL-CR warning series suppresses only non-EN elements, so absence of a BT from CR rules means the element is EN-allowed.
- Peppol sch contains national rules (IS-R-004 BT-47 Iceland, DK 0184, NO 0196) — check country applicability before treating them as binding for a BE/DE preset.
- Spec `BusinessRecipient` is a closed object (`additionalProperties: false`): no trading name, no contact group; `company_id` is a bare string without a scheme slot; `name` → `LegalName` → `PlainString128` (bare string). `ConsumerRecipient.name` → `NaturalName` → `PersonName` (required gender/forename/surname) — but ConsumerRecipient's own description says "Not supported yet", so BUSINESS is the only supported recipient type. Both variants structurally carry `invoicing` (don't trust CLAUDE.md's "type: BUSINESS with invoicing" as a schema fact). Confirmed 2026-09-07 for fatturapa buyer.person.forename/surname json rows (R2 should-fix, UAPI_PARTIAL_FIELDS); FatturaPA leg: AnagraficaType choice Denominazione | Nome+Cognome at XSD line 680, buyer map rows fpa 1.4.1.3.2/.3 — sibling ubl/cii/xrechnung buyer.person rows share the reason string.
