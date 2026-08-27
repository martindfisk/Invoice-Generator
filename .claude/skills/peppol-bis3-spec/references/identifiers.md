# Identifier cheat-sheet

| Purpose | UBL path | Example |
|---|---|---|
| Seller endpoint (BT-34) | `cac:AccountingSupplierParty/cac:Party/cbc:EndpointID/@schemeID` + value | `0208` / `0123456789` |
| Buyer endpoint (BT-49) | `cac:AccountingCustomerParty/cac:Party/cbc:EndpointID` | `0211` / `01234567890` (IT VAT) |
| Seller VAT id (BT-31) | `.../cac:PartyTaxScheme/cbc:CompanyID` with `cac:TaxScheme/cbc:ID=VAT` | `BE0123456789` |
| Seller legal reg. (BT-30) | `.../cac:PartyLegalEntity/cbc:CompanyID/@schemeID` | `0208` |
| Buyer reference (BT-10) | `cbc:BuyerReference` | `PO-2026-001` |
| PO reference (BT-13) | `cac:OrderReference/cbc:ID` | `PO-2026-001` |

Peppol participant identifier (network address) = `<EAS>:<value>` e.g. `0208:0123456789`; UAPI `recipients[].invoicing.identifier` uses the same string.
