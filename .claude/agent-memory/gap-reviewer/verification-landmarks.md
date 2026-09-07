---
name: verification-landmarks
description: Fastest decisive sources for judging gap-report rows, plus known false-positive patterns found in the cii|json audit (2026-09-07)
metadata:
  type: project
---

Decisive method for missingFrom=json rows: the fiskaly spec self-annotates BTs per country profile.
`grep -o "(BT-[0-9]*[^)]*)" spec/fiskaly.unified-api.all.<ver>.yaml | sort -u` yields the complete
inventory of business terms the contract claims to carry; a BT absent from that inventory AND from
the schema property set is a confirmed json gap, a BT present refutes "the operation has no pointer".

**Why:** reasons quoted from uapi-map.ts are claims about the contract; the contract's own BT
annotations settle them without any web fetch.

**How to apply:** run the inventory first, then read only the schemas the cause names.

Known false-positive pattern (affects every format, not just cii): `gap-report.ts` applies
`SAME_DATUM` only to the xml-carried check, not to the json-presence check, so
`buyer.electronicAddress.id/.scheme` rows surface as "The operation has no pointer for this field"
even though uapi-map.ts:616-618 deliberately excludes BT-49 from UAPI_LOSSY_FIELDS (carried at
/recipients/{i}/invoicing/identifier|email, both spec-annotated BT-49 for DE_EI). Same shape:
`vatBreakdown.{i}.reason` (BT-120) — spec annotates /entries/{i}/data/vat/reason as BT-120, so the
term is carried at entry level. Refuted in the 2026-09-07 cii|json audit; expect the twin rows in
ubl/xrechnung audits.

Other durable findings from that audit:

- Seller electronic address (BT-34) is platform-sourced from **System.annotations.peppol_id**
  (spec ~4609), NOT the Taxpayer — the "seller comes from the taxpayer resource" reason is wrong
  for that pair; German Taxpayer fiscalization also has no company-register id, so BT-30 sourcing
  is unproven for DE.
- VatExclusive (used at /totals/vat/exclusive) is annotated BT-106+BT-109+BT-116 — refutes
  "BT-106 not carried" (totals.lineExtension row).
- Exemption/reverse-charge rate rows lose nothing: BR-E-05/BR-AE-05/BR-Z-05 fix the rate at 0 and
  BR-O-05 forbids it (vendor/schematron/CEN-EN16931-UBL.sch:246,330,358); XRechnung model BT-119
  usage note says "ist der Wert 0 zu übermitteln" — severity note, not should-fix.
- The UNKNOWN-instruction text ambiguity is client-made (uapi-map.ts:471 `text: remittanceInformation
?? terms`), not an operation gap — /payments/{i}/instruction/text is spec-annotated BT-83 and
  terms have their own home /document/payment_terms (BT-20).
- FatturaPA capture (docs/reference/fatturapa/README.md) proves for that path only: seller platform,
  breakdown/totals discarded+recomputed, details.number discarded. Use as analogy for CII/UBL and
  say so explicitly.
- bt-catalog.json carries Peppol/XRechnung-flavoured cardinalities (BT-34/BT-49/BT-119 as 1..1;
  EN 16931-1:2017 has them 0..1) and its BT-119 description wrongly includes O among "must be 0".
