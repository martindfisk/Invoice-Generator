---
name: peppol-bis3-spec
description: Peppol BIS Billing 3.0 (UBL 2.1 Invoice/CreditNote) — identifiers, mandatory business terms, Peppol-specific rules, EAS/ISO 6523 participant schemes, code lists, Belgian B2B mandate context and the UAPI E-INVOICE BE mapping. Load when writing or reviewing UBL, Peppol identifiers or the BE preset.
---

# Peppol BIS Billing 3.0 (UBL)

A CIUS of EN 16931 on the UBL 2.1 binding. Documents: `Invoice` (`urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`) and `CreditNote`. Namespaces `cac` = `…CommonAggregateComponents-2`, `cbc` = `…CommonBasicComponents-2`.

## Identifiers
- `cbc:CustomizationID` = `urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0` (BT-24)
- `cbc:ProfileID` = `urn:fdc:peppol.eu:2017:poacc:billing:01:1.0` (BT-23)
- `cbc:InvoiceTypeCode` 380 (commercial invoice); credit note `cbc:CreditNoteTypeCode` 381. Other UNCL1001 codes allowed by BIS (e.g. 384 corrected, 389 self-billed) — use 380/381 in presets.
- Participant / electronic address: `cbc:EndpointID schemeID="<EAS>"` for seller (BT-34, PEPPOL-EN16931-R020) and buyer (BT-49, R010). Peppol participant id string form `<EAS>:<value>`, e.g. `0208:0123456789`.
- EAS codes used here: `0208` Belgian enterprise number (KBO/BCE, 10 digits) · `0211` Italian partita IVA · `0210` Italian codice fiscale · `0088` GLN · `9925` BE:VAT (legacy) · `0204` DE Leitweg-ID · `9930` DE:VAT. Use the current EAS code list published by the EC/Peppol; do not invent.

## Mandatory content (beyond EN 16931 BR-*)
BT-1 number, BT-2 issue date, BT-5 currency, **BT-10 buyer reference or BT-13 purchase order reference (PEPPOL-EN16931-R003)**, seller name/address/country, seller VAT id (`cac:PartyTaxScheme/cbc:CompanyID` with `cac:TaxScheme/cbc:ID = VAT`) or legal registration (BR-CO-26), buyer name/address/country, BT-34/BT-49 endpoint ids, BG-16 payment instructions when payable > 0 (BT-81 UNCL4461: 30 credit transfer, 58 SEPA credit transfer, 48 card, 10 cash, 49 direct debit, 59 SEPA DD; BT-84 IBAN in `cac:PayeeFinancialAccount/cbc:ID`), BG-22 totals (BT-106 `LineExtensionAmount`, BT-109 `TaxExclusiveAmount`, BT-110 `cac:TaxTotal/cbc:TaxAmount`, BT-112 `TaxInclusiveAmount`, BT-115 `PayableAmount`), BG-23 one `cac:TaxSubtotal` per category+rate (BT-116 `TaxableAmount`, BT-117 `TaxAmount`, BT-118 `cac:TaxCategory/cbc:ID`, BT-119 `cbc:Percent`, BT-120/121 exemption reason text/code for E, AE, Z, O, K, G), BG-25 lines (BT-126 `cbc:ID`, BT-129 `cbc:InvoicedQuantity unitCode` UN/ECE Rec 20, e.g. `C62`, `H87`, `EA`; BT-131 `cbc:LineExtensionAmount`; BT-146 `cac:Price/cbc:PriceAmount`; BT-153 `cac:Item/cbc:Name`; BT-151/152 `cac:Item/cac:ClassifiedTaxCategory`).
- VAT categories UNCL5305: S standard · Z zero · E exempt · AE reverse charge · K intra-community supply · G export · O not subject · L Canary Islands · M Ceuta/Melilla. Reverse charge/export lines need BT-120 or BT-121 (VATEX list).
- Peppol rules to remember: R001/R007 business process, R004 CustomizationID, R003 buyer ref or PO ref, R008 no empty elements, R010/R020 endpoint ids, R040–R044 allowance/charge rates, R046 non-negative net price, R051 all `currencyID` equal to BT-5, R053/R054 rounding, R061 direct-debit mandate. CEN rules: BR-*, BR-CO-*, BR-S/E/AE/Z/G/K/O-*.
- Rule sets: `github.com/OpenPEPPOL/peppol-bis-invoice-3` (`rules/sch/PEPPOL-EN16931-UBL.sch`, `rules/sch/CEN-EN16931-UBL.sch`, compiled XSLT under `rules/xslt/`), released twice a year (spring/fall; mandatory ~6 weeks later). CEN artefacts: `github.com/ConnectingEurope/eInvoicing-EN16931` (1.3.16, 2026-04-10; local clone 1.3.15). Pin versions in `frontend/public/sef/SOURCES.md`.

## Belgium context (preset "Peppol BE")
B2B e-invoicing mandatory between Belgian VAT-registered businesses from **1 Jan 2026** (law of 6 Feb 2024 amending the VAT Code; Peppol BIS 3.0 over the Peppol network as default). Belgian Peppol Authority: BOSA. Seller/buyer identified by `0208:<KBO 10 digits>`; VAT id `BE0123456789`. Standard rate 21 %, reduced 6 % / 12 %.

## UAPI mapping (E-INVOICE BE)
Recipient `invoicing: {type: "PEPPOL", identifier: "0208:<buyer KBO>"}`; sender id from `system.annotations.peppol_id`. fiskaly generates the UBL (`en16931-invoice` workflow) — confirm the artifact's `CustomizationID` before labelling it BIS 3.0 (spike M1 d). Rates map to `vat_rates` codes (`STANDARD`, `REDUCED_n`), exemptions to `CAUSE_n`.

## References
Local: EN 16931 UBL examples/tests `/Users/martin.dutzler/Documents/GitHub/bodex/countries/e-invoicing (all countries)/EN16931 standard/ubl/` (incl. `examples/BIS3_Invoice_positive.XML`), UBL 2.1 XSD in the XRechnung 3.0.2 validator bundle under `/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Germany/`, Peppol specs `/Users/martin.dutzler/Documents/GitHub/Peppol/docs/peppol/`. Web: https://docs.peppol.eu/poacc/billing/3.0/ (syntax, rules, code lists).
