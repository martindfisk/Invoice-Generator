# CEN EN 16931 BR-\* unit fixtures

Six vefa-validator `<testSet>` documents from the CEN/TC 434 EN 16931 validation artefacts
(`test/Invoice-unit-UBL/` in the eInvoicing-EN16931 repository, version 1.3.15 — the same release
`tools/rulesets.json` pins for the rule sets). Each `<test>` holds an inline Invoice fragment plus
the one rule id it must trigger (`<error>`) or satisfy (`<success>`).

Copied verbatim on 2026-09-07 so `frontend/tests/schematron.test.ts` runs everywhere the SEFs
exist (before this, the suite silently skipped on any machine without a local clone of the CEN
artefacts — CI reported green with zero BR-\* coverage).

Licence: **EUPL-1.2** (CEN/TC 434 validation artefacts). Redistribution of these test documents is
permitted under that licence; the licence text ships with the artefacts' distribution and is
referenced from `vendor/SOURCES.md`.

| File          | Rule under test                     |
| ------------- | ----------------------------------- |
| BR-11.xml     | Buyer postal address country code   |
| BR-16.xml     | At least one invoice line           |
| BR-CO-10.xml  | Σ line net amounts = BT-106         |
| BR-CO-15.xml  | Amount due = total with VAT − paid  |
| BR-S-08-1.xml | Standard-rate breakdown taxable sum |
| BR-CL-01.xml  | Invoice type code from UNTDID 1001  |
