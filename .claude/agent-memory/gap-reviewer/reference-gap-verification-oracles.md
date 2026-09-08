---
name: gap-verification-oracles
description: Fastest sources for judging gap-report rows — the fiskaly spec's per-profile "(BT-xx …)" annotations, and the known SAME_DATUM asymmetry in gap-report.ts that emits false "no pointer" rows
metadata:
  type: reference
---

The fiskaly spec (`spec/fiskaly.unified-api.all.<version>.yaml`) embeds per-profile EN 16931 annotations in schema descriptions — grep `"BT-"` settles which terms the operation carries before touching any standard. Non-obvious carriers found 2026-09: BT-49 on `RecipientInvoicingPeppol.identifier` and `RecipientInvoicingEmail.email`; BT-120 on `VatExemptionReason` (line-level `/entries/{i}/data/vat/reason`); seller BT-31/BT-32 on the country VAT/tax-id schemas of the **Taxpayer** resource; BT-106+BT-109+BT-116 all on `VatExclusive` (one field, three terms).

`frontend/src/gap-report.ts` applies `SAME_DATUM` only on the XML side (~line 222-225), not when deciding `inJson` — so model fields whose datum travels under an alias spelling (buyer.electronicAddress.*, vatBreakdown.{i}.reason) surface as false "The operation has no pointer for this field" rows. Severity rubric lives in `docs/gaps/README.md` (R1-R4); "a mandatory business term missing from the _operation_ is deliberately not blocking" is by design.

Only transmission capture: `docs/reference/fatturapa/` (FatturaPA path only — UBL/CII/XRechnung rendering claims stay unproven; say "by analogy" when leaning on it).
