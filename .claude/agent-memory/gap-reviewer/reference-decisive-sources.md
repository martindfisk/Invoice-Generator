---
name: reference-decisive-sources
description: Which offline sources settle which gap-report propositions, and the fastest lookups (spec BT labels, capture, XSD, severityFor)
metadata:
  type: reference
---

Fastest routes to a verdict, in order of authority per proposition:

- **gap-is-real / reason-true for `missingFrom: json`** — the spec's own per-country prose embeds EN BT labels: grep `spec/fiskaly.unified-api.all.2026-06-01.yaml` descriptions for `(BT-` with the IT_EI/BE_EI/DE_EI flag groups. Examples that refute "no pointer" claims: `SdiDestinationCode` = "(BT-49 Buyer electronic address)" for IT_EI; `VatExemptionReason` (line-level `/entries/{i}/data/vat/reason`) = "(BT-120 VAT exemption reason text)"; instruction fields = BT-84/85/86; `DocumentReferences*` = BT-10/11/12/13/16/17/19. Parse YAML with `backend/.venv/bin/python` (system python3 lacks PyYAML).
- **FatturaPA structure** — `vendor/fatturapa/Schema_VFPR12_v1.2.3.xsd` (vendored, exists). Key facts verified there: DatiDDT requires BOTH NumeroDDT and DataDDT (1..1); buyer DatiAnagrafici allows IdFiscaleIVA AND CodiceFiscale together; AnagraficaType = choice Denominazione | Nome+Cognome; NaturaType marks N2/N3 invalid since 2021-01-01 (sub-codes mandatory); Arrotondamento 0..1 in DatiGeneraliDocumento; EsigibilitaIVA 0..1 (I/D/S); CondizioniPagamento 1..1 in DatiPagamento, ModalitaPagamento 1..1 in DettaglioPagamento.
- **What fiskaly actually rendered** — `docs/reference/fatturapa/{README.md,tested-payload.json,tested-response.xml}` (captured 2026-08-25). Seller identity/Sede/REA/RegimeFiscale = platform from Taxpayer; TipoDocumento TD01, TP02/MP05 derived; breakdown+totals discarded and DatiRiepilogo recomputed; buyer_id/company_id not rendered. Caveat: the payload never sent `details.number`, `despatch_advice`, or any exemption line — the capture cannot prove fates for those.
- **Severity taxonomy** — `frontend/src/gap-report.ts` `severityFor()`: `platform → note (R4)` is checked BEFORE the R2 should-fix branch. EN cardinality (R1 blocking) only binds syntaxes that are a CIUS of EN 16931 — FatturaPA is not.
- **EN semantics by analogy** — `vendor/schematron/CEN-EN16931-UBL.sch` (BR-E-05/BR-AE-05: rate shall be 0), `frontend/src/bt-catalog.json` and `/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Outputted files/EN16931_BT_BG_Reference.md` (BT-16 is identifier-only, no date; BT-36 = "an additional address line"). Always state analogy-vs-FatturaPA-own explicitly.
