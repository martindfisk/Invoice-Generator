# Mapping reference

<!-- GENERATED FILE — do not edit by hand. -->
<!-- Source: frontend/src/{ubl,fatturapa,cii,xrechnung}-map.ts, uapi-map.ts, uapi-field-fate.ts. -->
<!-- Regenerate with `make handbook`; `make handbook-check` fails CI when this file is stale. -->

Every table below is rendered from the mapping data the writers themselves consume, so this
reference cannot drift from the code. Concepts (how the tables are used, what lossiness and
fates mean) live in [03 — Mappings](03-mappings.md); this chapter is the lookup.

Reading the tables: **Model field** is the canonical `Invoice` `FieldId` (`""` / — means the
element is a constant of the format, authored by the writer, not by a field). `{i}` marks a
repeating group (invoice lines, VAT breakdown rows, recipients). **BT-x** ids are EN 16931
business terms; **FPA** paths are FatturaPA blocks (specs 1.9.1).

## Peppol BIS Billing 3.0 (UBL 2.1) (`ubl`)

XSD tier: `ubl-invoice-2.1` · declared validation stages: `model`, `well-formed`, `xsd`, `schematron`

| Model field | Document path | BT / FPA | Meaning |
| --- | --- | --- | --- |
| — | `Invoice/cbc:CustomizationID` | BT-24 | Specification identifier (Peppol BIS Billing 3.0) |
| — | `Invoice/cbc:ProfileID` | BT-23 | Business process type (Peppol BIS Billing 3.0) |
| `number` | `Invoice/cbc:ID` | BT-1 | Invoice number |
| `issueDate` | `Invoice/cbc:IssueDate` | BT-2 | Invoice issue date |
| `dueDate` | `Invoice/cbc:DueDate` | BT-9 | Payment due date |
| `typeCode` | `Invoice/cbc:InvoiceTypeCode` | BT-3 | Invoice type code (UNCL1001) |
| `note` | `Invoice/cbc:Note` | BT-22 | Invoice note |
| `currency` | `Invoice/cbc:DocumentCurrencyCode` | BT-5 | Invoice currency code (ISO 4217) |
| `references.buyerReference` | `Invoice/cbc:BuyerReference` | BT-10 | Buyer reference |
| `references.purchaseOrder` | `Invoice/cac:OrderReference/cbc:ID` | BT-13 | Purchase order reference |
| `references.salesOrder` | `Invoice/cac:OrderReference/cbc:SalesOrderID` | BT-14 | Sales order reference |
| `references.precedingInvoice.number` | `Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID` | BT-25 | Preceding invoice reference |
| `references.precedingInvoice.issueDate` | `Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate` | BT-26 | Preceding invoice issue date |
| `references.despatchAdvice.number` | `Invoice/cac:DespatchDocumentReference/cbc:ID` | BT-16 | Despatch advice reference |
| `references.tenderOrLot` | `Invoice/cac:OriginatorDocumentReference/cbc:ID` | BT-17 | Tender or lot reference |
| `references.contract` | `Invoice/cac:ContractDocumentReference/cbc:ID` | BT-12 | Contract reference |
| `references.invoicedObject` | `Invoice/cac:AdditionalDocumentReference/cbc:ID` | BT-18 | Invoiced object identifier |
| — | `Invoice/cac:AdditionalDocumentReference/cbc:DocumentTypeCode` | BT-18 | Invoiced object document type code (UNCL1001 130, EN 16931 UBL binding) |
| `references.project` | `Invoice/cac:ProjectReference/cbc:ID` | BT-11 | Project reference |
| `seller.electronicAddress.id` | `Invoice/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID` | BT-34 | Seller electronic address |
| `seller.electronicAddress.scheme` | `Invoice/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID/@schemeID` | BT-34-1 | Seller electronic address scheme (EAS) |
| `seller.tradeName` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name` | BT-28 | Seller trading name |
| `seller.address.street` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:StreetName` | BT-35 | Seller address line 1 |
| `seller.address.number` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:AdditionalStreetName` | BT-36 | Seller address line 2 |
| `seller.address.city` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CityName` | BT-37 | Seller city |
| `seller.address.postCode` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:PostalZone` | BT-38 | Seller post code |
| `seller.address.region` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity` | BT-39 | Seller country subdivision |
| `seller.address.country` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode` | BT-40 | Seller country code (ISO 3166-1 alpha-2) |
| `seller.vatId` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` | BT-31 | Seller VAT identifier |
| `seller.name` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName` | BT-27 | Seller name |
| `seller.legalRegId` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID` | BT-30 | Seller legal registration identifier |
| `seller.legalRegScheme` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID/@schemeID` | BT-30-1 | Seller legal registration scheme (ISO 6523 ICD) |
| `seller.contact.name` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Name` | BT-41 | Seller contact point |
| `seller.contact.phone` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telephone` | BT-42 | Seller contact telephone number |
| `seller.contact.email` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:ElectronicMail` | BT-43 | Seller contact email address |
| `buyer.electronicAddress.id` | `Invoice/cac:AccountingCustomerParty/cac:Party/cbc:EndpointID` | BT-49 | Buyer electronic address |
| `buyer.electronicAddress.scheme` | `Invoice/cac:AccountingCustomerParty/cac:Party/cbc:EndpointID/@schemeID` | BT-49-1 | Buyer electronic address scheme (EAS) |
| `buyer.tradeName` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name` | BT-45 | Buyer trading name |
| `buyer.address.street` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:StreetName` | BT-50 | Buyer address line 1 |
| `buyer.address.number` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:AdditionalStreetName` | BT-51 | Buyer address line 2 |
| `buyer.address.city` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CityName` | BT-52 | Buyer city |
| `buyer.address.postCode` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:PostalZone` | BT-53 | Buyer post code |
| `buyer.address.region` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity` | BT-54 | Buyer country subdivision |
| `buyer.address.country` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode` | BT-55 | Buyer country code (ISO 3166-1 alpha-2) |
| `buyer.vatId` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` | BT-48 | Buyer VAT identifier |
| `buyer.name` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName` | BT-44 | Buyer name |
| `buyer.legalRegId` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID` | BT-47 | Buyer legal registration identifier |
| `buyer.legalRegScheme` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID/@schemeID` | BT-47-1 | Buyer legal registration scheme (ISO 6523 ICD) |
| `buyer.contact.name` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:Name` | BT-56 | Buyer contact point |
| `buyer.contact.phone` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:Telephone` | BT-57 | Buyer contact telephone number |
| `buyer.contact.email` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:ElectronicMail` | BT-58 | Buyer contact email address |
| `delivery.date` | `Invoice/cac:Delivery/cbc:ActualDeliveryDate` | BT-72 | Actual delivery date |
| `payment.meansCode` | `Invoice/cac:PaymentMeans/cbc:PaymentMeansCode` | BT-81 | Payment means type code (UNCL4461) |
| `payment.meansText` | `Invoice/cac:PaymentMeans/cbc:PaymentMeansCode/@name` | BT-82 | Payment means text |
| `payment.remittanceInformation` | `Invoice/cac:PaymentMeans/cbc:PaymentID` | BT-83 | Remittance information |
| `payment.iban` | `Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID` | BT-84 | Payment account identifier (IBAN) |
| `payment.accountName` | `Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name` | BT-85 | Payment account name |
| `payment.bic` | `Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID` | BT-86 | Payment service provider identifier (BIC) |
| `payment.terms` | `Invoice/cac:PaymentTerms/cbc:Note` | BT-20 | Payment terms |
| `totals.taxAmount` | `Invoice/cac:TaxTotal/cbc:TaxAmount` | BT-110 | Invoice total VAT amount |
| `vatBreakdown.{i}.taxableAmount` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cbc:TaxableAmount` | BT-116 | VAT category taxable amount |
| `vatBreakdown.{i}.taxAmount` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cbc:TaxAmount` | BT-117 | VAT category tax amount |
| `vatBreakdown.{i}.category` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:ID` | BT-118 | VAT category code (UNCL5305) |
| `vatBreakdown.{i}.rate` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:Percent` | BT-119 | VAT category rate |
| `vatBreakdown.{i}.vatexCode` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:TaxExemptionReasonCode` | BT-121 | VAT exemption reason code (VATEX) |
| `vatBreakdown.{i}.reason` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:TaxExemptionReason` | BT-120 | VAT exemption reason text |
| `totals.lineExtension` | `Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount` | BT-106 | Sum of invoice line net amounts |
| `totals.taxExclusive` | `Invoice/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount` | BT-109 | Invoice total amount without VAT |
| `totals.taxInclusive` | `Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount` | BT-112 | Invoice total amount with VAT |
| `totals.allowance` | `Invoice/cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount` | BT-107 | Sum of allowances on document level |
| `totals.charge` | `Invoice/cac:LegalMonetaryTotal/cbc:ChargeTotalAmount` | BT-108 | Sum of charges on document level |
| `totals.prepaid` | `Invoice/cac:LegalMonetaryTotal/cbc:PrepaidAmount` | BT-113 | Paid amount |
| `totals.rounding` | `Invoice/cac:LegalMonetaryTotal/cbc:PayableRoundingAmount` | BT-114 | Rounding amount |
| `totals.payable` | `Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount` | BT-115 | Amount due for payment |
| `lines.{i}.id` | `Invoice/cac:InvoiceLine[{i}]/cbc:ID` | BT-126 | Invoice line identifier |
| `lines.{i}.quantity` | `Invoice/cac:InvoiceLine[{i}]/cbc:InvoicedQuantity` | BT-129 | Invoiced quantity |
| `lines.{i}.unitCode` | `Invoice/cac:InvoiceLine[{i}]/cbc:InvoicedQuantity/@unitCode` | BT-130 | Invoiced quantity unit of measure (UN/ECE Rec 20) |
| `lines.{i}.netAmount` | `Invoice/cac:InvoiceLine[{i}]/cbc:LineExtensionAmount` | BT-131 | Invoice line net amount |
| `lines.{i}.description` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cbc:Description` | BT-154 | Item description |
| `lines.{i}.name` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cbc:Name` | BT-153 | Item name |
| `lines.{i}.vat.category` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cac:ClassifiedTaxCategory/cbc:ID` | BT-151 | Invoiced item VAT category code |
| `lines.{i}.vat.rate` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent` | BT-152 | Invoiced item VAT rate |
| `lines.{i}.unitPriceNet` | `Invoice/cac:InvoiceLine[{i}]/cac:Price/cbc:PriceAmount` | BT-146 | Item net price |

## XRechnung 3.0.2 (UBL 2.1) (`xrechnung`)

XSD tier: `ubl-invoice-2.1` · declared validation stages: `model`, `well-formed`, `xsd`, `schematron`

| Model field | Document path | BT / FPA | Meaning |
| --- | --- | --- | --- |
| — | `Invoice/cbc:CustomizationID` | BT-24 | Specification identifier (XRechnung 3.0.2, urn:xeinkauf.de:kosit:xrechnung_3.0) |
| — | `Invoice/cbc:ProfileID` | BT-23 | Business process type (Peppol BIS Billing 3.0) |
| `number` | `Invoice/cbc:ID` | BT-1 | Invoice number |
| `issueDate` | `Invoice/cbc:IssueDate` | BT-2 | Invoice issue date |
| `dueDate` | `Invoice/cbc:DueDate` | BT-9 | Payment due date |
| `typeCode` | `Invoice/cbc:InvoiceTypeCode` | BT-3 | Invoice type code (UNCL1001) |
| `note` | `Invoice/cbc:Note` | BT-22 | Invoice note |
| `currency` | `Invoice/cbc:DocumentCurrencyCode` | BT-5 | Invoice currency code (ISO 4217) |
| `references.buyerReference` | `Invoice/cbc:BuyerReference` | BT-10 | Buyer reference - Leitweg-ID, mandatory in XRechnung (BR-DE-15) |
| `references.purchaseOrder` | `Invoice/cac:OrderReference/cbc:ID` | BT-13 | Purchase order reference |
| `references.salesOrder` | `Invoice/cac:OrderReference/cbc:SalesOrderID` | BT-14 | Sales order reference |
| `references.precedingInvoice.number` | `Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID` | BT-25 | Preceding invoice reference |
| `references.precedingInvoice.issueDate` | `Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate` | BT-26 | Preceding invoice issue date |
| `references.despatchAdvice.number` | `Invoice/cac:DespatchDocumentReference/cbc:ID` | BT-16 | Despatch advice reference |
| `references.tenderOrLot` | `Invoice/cac:OriginatorDocumentReference/cbc:ID` | BT-17 | Tender or lot reference |
| `references.contract` | `Invoice/cac:ContractDocumentReference/cbc:ID` | BT-12 | Contract reference |
| `references.invoicedObject` | `Invoice/cac:AdditionalDocumentReference/cbc:ID` | BT-18 | Invoiced object identifier |
| — | `Invoice/cac:AdditionalDocumentReference/cbc:DocumentTypeCode` | BT-18 | Invoiced object document type code (UNCL1001 130, EN 16931 UBL binding) |
| `references.project` | `Invoice/cac:ProjectReference/cbc:ID` | BT-11 | Project reference |
| `seller.electronicAddress.id` | `Invoice/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID` | BT-34 | Seller electronic address |
| `seller.electronicAddress.scheme` | `Invoice/cac:AccountingSupplierParty/cac:Party/cbc:EndpointID/@schemeID` | BT-34-1 | Seller electronic address scheme (EAS) |
| `seller.tradeName` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyName/cbc:Name` | BT-28 | Seller trading name |
| `seller.address.street` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:StreetName` | BT-35 | Seller address line 1 |
| `seller.address.number` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:AdditionalStreetName` | BT-36 | Seller address line 2 |
| `seller.address.city` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CityName` | BT-37 | Seller city |
| `seller.address.postCode` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:PostalZone` | BT-38 | Seller post code |
| `seller.address.region` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity` | BT-39 | Seller country subdivision |
| `seller.address.country` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode` | BT-40 | Seller country code (ISO 3166-1 alpha-2) |
| `seller.vatId` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` | BT-31 | Seller VAT identifier |
| `seller.name` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName` | BT-27 | Seller name |
| `seller.legalRegId` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID` | BT-30 | Seller legal registration identifier |
| `seller.legalRegScheme` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID/@schemeID` | BT-30-1 | Seller legal registration scheme (ISO 6523 ICD) |
| `seller.contact.name` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Name` | BT-41 | Seller contact point - mandatory in XRechnung (BR-DE-5) |
| `seller.contact.phone` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telephone` | BT-42 | Seller contact telephone number - mandatory in XRechnung (BR-DE-6) |
| `seller.contact.email` | `Invoice/cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:ElectronicMail` | BT-43 | Seller contact email address - mandatory in XRechnung (BR-DE-7) |
| `buyer.electronicAddress.id` | `Invoice/cac:AccountingCustomerParty/cac:Party/cbc:EndpointID` | BT-49 | Buyer electronic address |
| `buyer.electronicAddress.scheme` | `Invoice/cac:AccountingCustomerParty/cac:Party/cbc:EndpointID/@schemeID` | BT-49-1 | Buyer electronic address scheme (EAS) |
| `buyer.tradeName` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyName/cbc:Name` | BT-45 | Buyer trading name |
| `buyer.address.street` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:StreetName` | BT-50 | Buyer address line 1 |
| `buyer.address.number` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:AdditionalStreetName` | BT-51 | Buyer address line 2 |
| `buyer.address.city` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CityName` | BT-52 | Buyer city |
| `buyer.address.postCode` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:PostalZone` | BT-53 | Buyer post code |
| `buyer.address.region` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity` | BT-54 | Buyer country subdivision |
| `buyer.address.country` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode` | BT-55 | Buyer country code (ISO 3166-1 alpha-2) |
| `buyer.vatId` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` | BT-48 | Buyer VAT identifier |
| `buyer.name` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName` | BT-44 | Buyer name |
| `buyer.legalRegId` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID` | BT-47 | Buyer legal registration identifier |
| `buyer.legalRegScheme` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID/@schemeID` | BT-47-1 | Buyer legal registration scheme (ISO 6523 ICD) |
| `buyer.contact.name` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:Name` | BT-56 | Buyer contact point |
| `buyer.contact.phone` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:Telephone` | BT-57 | Buyer contact telephone number |
| `buyer.contact.email` | `Invoice/cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:ElectronicMail` | BT-58 | Buyer contact email address |
| `delivery.date` | `Invoice/cac:Delivery/cbc:ActualDeliveryDate` | BT-72 | Actual delivery date |
| `payment.meansCode` | `Invoice/cac:PaymentMeans/cbc:PaymentMeansCode` | BT-81 | Payment means type code (UNCL4461) |
| `payment.meansText` | `Invoice/cac:PaymentMeans/cbc:PaymentMeansCode/@name` | BT-82 | Payment means text |
| `payment.remittanceInformation` | `Invoice/cac:PaymentMeans/cbc:PaymentID` | BT-83 | Remittance information |
| `payment.iban` | `Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID` | BT-84 | Payment account identifier (IBAN) |
| `payment.accountName` | `Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name` | BT-85 | Payment account name |
| `payment.bic` | `Invoice/cac:PaymentMeans/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID` | BT-86 | Payment service provider identifier (BIC) |
| `payment.terms` | `Invoice/cac:PaymentTerms/cbc:Note` | BT-20 | Payment terms |
| `totals.taxAmount` | `Invoice/cac:TaxTotal/cbc:TaxAmount` | BT-110 | Invoice total VAT amount |
| `vatBreakdown.{i}.taxableAmount` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cbc:TaxableAmount` | BT-116 | VAT category taxable amount |
| `vatBreakdown.{i}.taxAmount` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cbc:TaxAmount` | BT-117 | VAT category tax amount |
| `vatBreakdown.{i}.category` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:ID` | BT-118 | VAT category code (UNCL5305) |
| `vatBreakdown.{i}.rate` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:Percent` | BT-119 | VAT category rate |
| `vatBreakdown.{i}.vatexCode` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:TaxExemptionReasonCode` | BT-121 | VAT exemption reason code (VATEX) |
| `vatBreakdown.{i}.reason` | `Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]/cac:TaxCategory/cbc:TaxExemptionReason` | BT-120 | VAT exemption reason text |
| `totals.lineExtension` | `Invoice/cac:LegalMonetaryTotal/cbc:LineExtensionAmount` | BT-106 | Sum of invoice line net amounts |
| `totals.taxExclusive` | `Invoice/cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount` | BT-109 | Invoice total amount without VAT |
| `totals.taxInclusive` | `Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount` | BT-112 | Invoice total amount with VAT |
| `totals.allowance` | `Invoice/cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount` | BT-107 | Sum of allowances on document level |
| `totals.charge` | `Invoice/cac:LegalMonetaryTotal/cbc:ChargeTotalAmount` | BT-108 | Sum of charges on document level |
| `totals.prepaid` | `Invoice/cac:LegalMonetaryTotal/cbc:PrepaidAmount` | BT-113 | Paid amount |
| `totals.rounding` | `Invoice/cac:LegalMonetaryTotal/cbc:PayableRoundingAmount` | BT-114 | Rounding amount |
| `totals.payable` | `Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount` | BT-115 | Amount due for payment |
| `lines.{i}.id` | `Invoice/cac:InvoiceLine[{i}]/cbc:ID` | BT-126 | Invoice line identifier |
| `lines.{i}.quantity` | `Invoice/cac:InvoiceLine[{i}]/cbc:InvoicedQuantity` | BT-129 | Invoiced quantity |
| `lines.{i}.unitCode` | `Invoice/cac:InvoiceLine[{i}]/cbc:InvoicedQuantity/@unitCode` | BT-130 | Invoiced quantity unit of measure (UN/ECE Rec 20) |
| `lines.{i}.netAmount` | `Invoice/cac:InvoiceLine[{i}]/cbc:LineExtensionAmount` | BT-131 | Invoice line net amount |
| `lines.{i}.description` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cbc:Description` | BT-154 | Item description |
| `lines.{i}.name` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cbc:Name` | BT-153 | Item name |
| `lines.{i}.vat.category` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cac:ClassifiedTaxCategory/cbc:ID` | BT-151 | Invoiced item VAT category code |
| `lines.{i}.vat.rate` | `Invoice/cac:InvoiceLine[{i}]/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent` | BT-152 | Invoiced item VAT rate |
| `lines.{i}.unitPriceNet` | `Invoice/cac:InvoiceLine[{i}]/cac:Price/cbc:PriceAmount` | BT-146 | Item net price |

## UN/CEFACT CII (Factur-X / ZUGFeRD EN 16931) (`cii`)

XSD tier: none vendored — Schematron is the structural tier · declared validation stages: `model`, `well-formed`, `schematron`

| Model field | Document path | BT / FPA | Meaning |
| --- | --- | --- | --- |
| — | `rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID` | BT-24 | Specification identifier (EN 16931 CII / Factur-X EN16931) |
| `number` | `rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:ID` | BT-1 | Invoice number |
| `typeCode` | `rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:TypeCode` | BT-3 | Invoice type code (UNCL1001) |
| `issueDate` | `rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString` | BT-2 | Invoice issue date (format 102, YYYYMMDD) |
| `note` | `rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IncludedNote/ram:Content` | BT-22 | Invoice note |
| `references.buyerReference` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerReference` | BT-10 | Buyer reference |
| `seller.name` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:Name` | BT-27 | Seller name |
| `seller.legalRegId` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:ID` | BT-30 | Seller legal registration identifier |
| `seller.legalRegScheme` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:ID/@schemeID` | BT-30-1 | Seller legal registration scheme (ISO 6523 ICD) |
| `seller.tradeName` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:TradingBusinessName` | BT-28 | Seller trading name |
| `seller.contact.name` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonName` | BT-41 | Seller contact point |
| `seller.contact.phone` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber` | BT-42 | Seller contact telephone number |
| `seller.contact.email` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID` | BT-43 | Seller contact email address |
| `seller.address.postCode` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode` | BT-38 | Seller post code |
| `seller.address.street` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:LineOne` | BT-35 | Seller address line 1 |
| `seller.address.number` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:LineTwo` | BT-36 | Seller address line 2 |
| `seller.address.city` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:CityName` | BT-37 | Seller city |
| `seller.address.country` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountryID` | BT-40 | Seller country code (ISO 3166-1 alpha-2) |
| `seller.address.region` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountrySubDivisionName` | BT-39 | Seller country subdivision |
| `seller.electronicAddress.id` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:URIUniversalCommunication/ram:URIID` | BT-34 | Seller electronic address |
| `seller.electronicAddress.scheme` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:URIUniversalCommunication/ram:URIID/@schemeID` | BT-34-1 | Seller electronic address scheme (EAS) |
| `seller.vatId` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration[ram:ID/@schemeID='VA']/ram:ID` | BT-31 | Seller VAT identifier |
| `seller.taxId` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration[ram:ID/@schemeID='FC']/ram:ID` | BT-32 | Seller tax registration identifier |
| `buyer.name` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:Name` | BT-44 | Buyer name |
| `buyer.legalRegId` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:ID` | BT-47 | Buyer legal registration identifier |
| `buyer.legalRegScheme` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:ID/@schemeID` | BT-47-1 | Buyer legal registration scheme (ISO 6523 ICD) |
| `buyer.tradeName` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:TradingBusinessName` | BT-45 | Buyer trading name |
| `buyer.contact.name` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonName` | BT-56 | Buyer contact point |
| `buyer.contact.phone` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber` | BT-57 | Buyer contact telephone number |
| `buyer.contact.email` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID` | BT-58 | Buyer contact email address |
| `buyer.address.postCode` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode` | BT-53 | Buyer post code |
| `buyer.address.street` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:LineOne` | BT-50 | Buyer address line 1 |
| `buyer.address.number` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:LineTwo` | BT-51 | Buyer address line 2 |
| `buyer.address.city` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CityName` | BT-52 | Buyer city |
| `buyer.address.country` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CountryID` | BT-55 | Buyer country code (ISO 3166-1 alpha-2) |
| `buyer.address.region` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CountrySubDivisionName` | BT-54 | Buyer country subdivision |
| `buyer.electronicAddress.id` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID` | BT-49 | Buyer electronic address |
| `buyer.electronicAddress.scheme` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID/@schemeID` | BT-49-1 | Buyer electronic address scheme (EAS) |
| `buyer.vatId` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:SpecifiedTaxRegistration[ram:ID/@schemeID='VA']/ram:ID` | BT-48 | Buyer VAT identifier |
| `references.salesOrder` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerOrderReferencedDocument/ram:IssuerAssignedID` | BT-14 | Sales order reference |
| `references.purchaseOrder` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID` | BT-13 | Purchase order reference |
| `references.contract` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:ContractReferencedDocument/ram:IssuerAssignedID` | BT-12 | Contract reference |
| `references.tenderOrLot` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument[ram:TypeCode='50']/ram:IssuerAssignedID` | BT-17 | Tender or lot reference |
| — | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument[ram:TypeCode='50']/ram:TypeCode` | BT-17 | Tender or lot document type code (UNCL1001 50, EN 16931 CII binding) |
| `references.invoicedObject` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument[ram:TypeCode='130']/ram:IssuerAssignedID` | BT-18 | Invoiced object identifier |
| — | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument[ram:TypeCode='130']/ram:TypeCode` | BT-18 | Invoiced object document type code (UNCL1001 130, EN 16931 CII binding) |
| `references.project` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SpecifiedProcuringProject/ram:ID` | BT-11 | Project reference |
| — | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SpecifiedProcuringProject/ram:Name` | BT-11 | Project name - required by ram:SpecifiedProcuringProject (CII D16B), echoes BT-11 |
| `references.despatchAdvice.number` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:DespatchAdviceReferencedDocument/ram:IssuerAssignedID` | BT-16 | Despatch advice reference |
| `payment.remittanceInformation` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:PaymentReference` | BT-83 | Remittance information |
| `currency` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode` | BT-5 | Invoice currency code (ISO 4217) |
| `payment.meansCode` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode` | BT-81 | Payment means type code (UNCL4461) |
| `payment.meansText` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:Information` | BT-82 | Payment means text |
| `payment.iban` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:IBANID` | BT-84 | Payment account identifier (IBAN) |
| `payment.accountName` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:AccountName` | BT-85 | Payment account name |
| `payment.bic` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID` | BT-86 | Payment service provider identifier (BIC) |
| `vatBreakdown.{i}.taxAmount` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[{i}]/ram:CalculatedAmount` | BT-117 | VAT category tax amount |
| `vatBreakdown.{i}.reason` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[{i}]/ram:ExemptionReason` | BT-120 | VAT exemption reason text |
| `vatBreakdown.{i}.taxableAmount` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[{i}]/ram:BasisAmount` | BT-116 | VAT category taxable amount |
| `vatBreakdown.{i}.category` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[{i}]/ram:CategoryCode` | BT-118 | VAT category code (UNCL5305) |
| `vatBreakdown.{i}.vatexCode` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[{i}]/ram:ExemptionReasonCode` | BT-121 | VAT exemption reason code (VATEX) |
| `vatBreakdown.{i}.rate` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[{i}]/ram:RateApplicablePercent` | BT-119 | VAT category rate |
| `payment.terms` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:Description` | BT-20 | Payment terms |
| `dueDate` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString` | BT-9 | Payment due date (format 102, YYYYMMDD) |
| `totals.lineExtension` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:LineTotalAmount` | BT-106 | Sum of invoice line net amounts |
| `totals.charge` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:ChargeTotalAmount` | BT-108 | Sum of charges on document level |
| `totals.allowance` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:AllowanceTotalAmount` | BT-107 | Sum of allowances on document level |
| `totals.taxExclusive` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount` | BT-109 | Invoice total amount without VAT |
| `totals.taxAmount` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount` | BT-110 | Invoice total VAT amount |
| `totals.rounding` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:RoundingAmount` | BT-114 | Rounding amount |
| `totals.taxInclusive` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount` | BT-112 | Invoice total amount with VAT |
| `totals.prepaid` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TotalPrepaidAmount` | BT-113 | Paid amount |
| `totals.payable` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:DuePayableAmount` | BT-115 | Amount due for payment |
| `references.precedingInvoice.number` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument/ram:IssuerAssignedID` | BT-25 | Preceding invoice reference |
| `references.precedingInvoice.issueDate` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument/ram:FormattedIssueDateTime/qdt:DateTimeString` | BT-26 | Preceding invoice issue date (format 102, YYYYMMDD) |
| `lines.{i}.id` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:AssociatedDocumentLineDocument/ram:LineID` | BT-126 | Invoice line identifier |
| `lines.{i}.name` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedTradeProduct/ram:Name` | BT-153 | Item name |
| `lines.{i}.description` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedTradeProduct/ram:Description` | BT-154 | Item description |
| `lines.{i}.unitPriceNet` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount` | BT-146 | Item net price |
| `lines.{i}.quantity` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity` | BT-129 | Invoiced quantity |
| `lines.{i}.unitCode` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode` | BT-130 | Invoiced quantity unit of measure (UN/ECE Rec 20) |
| `lines.{i}.vat.category` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode` | BT-151 | Invoiced item VAT category code |
| `lines.{i}.vat.rate` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent` | BT-152 | Invoiced item VAT rate |
| `lines.{i}.netAmount` | `rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem[{i}]/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount` | BT-131 | Invoice line net amount |

## FatturaPA (SDI) (`fatturapa`)

XSD tier: `fatturapa-1.2` · declared validation stages: `model`, `well-formed`, `xsd`, `sdi-rules`

| Model field | Document path | BT / FPA | Meaning |
| --- | --- | --- | --- |
| `seller.address.country` | `p:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/IdTrasmittente/IdPaese` | 1.1.1.1 | Transmitter country code |
| `seller.taxId` | `p:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/IdTrasmittente/IdCodice` | 1.1.1.2 | Transmitter fiscal identifier |
| `number` | `p:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/ProgressivoInvio` | 1.1.2 | Transmission progressive number |
| — | `p:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/FormatoTrasmissione` | 1.1.3 | Transmission format (FPR12 B2B/B2C, FPA12 B2G) |
| `buyer.channel.codiceDestinatario` | `p:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/CodiceDestinatario` | BT-49 · 1.1.4 | SDI destination code |
| `buyer.channel.pec` | `p:FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione/PECDestinatario` | BT-49 · 1.1.6 | Recipient PEC address |
| `seller.vatId` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/IdFiscaleIVA/IdPaese` | BT-31 · 1.2.1.1.1 | Seller VAT country code |
| `seller.vatId` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/IdFiscaleIVA/IdCodice` | BT-31 · 1.2.1.1.2 | Seller VAT identifier |
| `seller.taxId` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/CodiceFiscale` | BT-32 · 1.2.1.2 | Seller tax registration identifier (codice fiscale) |
| `seller.name` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/Anagrafica/Denominazione` | BT-27 · 1.2.1.3.1 | Seller name |
| `seller.person.forename` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/Anagrafica/Nome` | 1.2.1.3.2 | Seller forename - AnagraficaType is a choice, so Nome + Cognome replace Denominazione for a sole trader or professional (XSD 1.2.3) |
| `seller.person.surname` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/Anagrafica/Cognome` | 1.2.1.3.3 | Seller surname - written only together with Nome, never beside Denominazione |
| `seller.it.regimeFiscale` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/DatiAnagrafici/RegimeFiscale` | 1.2.1.8 | Seller tax regime (RF01-RF20) |
| `seller.address.street` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Sede/Indirizzo` | BT-35 · 1.2.2.1 | Seller address line 1 |
| `seller.address.number` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Sede/NumeroCivico` | BT-36 · 1.2.2.2 | Seller street number |
| `seller.address.postCode` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Sede/CAP` | BT-38 · 1.2.2.3 | Seller post code |
| `seller.address.city` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Sede/Comune` | BT-37 · 1.2.2.4 | Seller city |
| `seller.address.region` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Sede/Provincia` | BT-39 · 1.2.2.5 | Seller province |
| `seller.address.country` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Sede/Nazione` | BT-40 · 1.2.2.6 | Seller country code |
| `seller.it.rea.office` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/IscrizioneREA/Ufficio` | BT-30 · 1.2.4.1 | REA registration office |
| `seller.it.rea.number` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/IscrizioneREA/NumeroREA` | BT-30 · 1.2.4.2 | REA registration number |
| `seller.it.rea.capital` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/IscrizioneREA/CapitaleSociale` | BT-33 · 1.2.4.3 | Share capital |
| `seller.it.rea.soleShareholder` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/IscrizioneREA/SocioUnico` | BT-33 · 1.2.4.4 | Sole shareholder indicator |
| `seller.it.rea.liquidation` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/IscrizioneREA/StatoLiquidazione` | BT-33 · 1.2.4.5 | Liquidation status |
| `seller.contact.phone` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Contatti/Telefono` | BT-42 · 1.2.5.1 | Seller contact telephone number |
| `seller.contact.email` | `p:FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore/Contatti/Email` | BT-43 · 1.2.5.3 | Seller contact email address |
| `buyer.vatId` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/IdFiscaleIVA/IdPaese` | BT-48 · 1.4.1.1.1 | Buyer VAT country code |
| `buyer.vatId` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/IdFiscaleIVA/IdCodice` | BT-48 · 1.4.1.1.2 | Buyer VAT identifier |
| `buyer.taxId` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/CodiceFiscale` | BT-46 · 1.4.1.2 | Buyer fiscal code |
| `buyer.name` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/Anagrafica/Denominazione` | BT-44 · 1.4.1.3.1 | Buyer name |
| `buyer.person.forename` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/Anagrafica/Nome` | 1.4.1.3.2 | Buyer forename - a private individual (B2C) is named by Nome + Cognome and carries CodiceFiscale without IdFiscaleIVA |
| `buyer.person.surname` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/DatiAnagrafici/Anagrafica/Cognome` | 1.4.1.3.3 | Buyer surname - written only together with Nome, never beside Denominazione |
| `buyer.address.street` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede/Indirizzo` | BT-50 · 1.4.2.1 | Buyer address line 1 |
| `buyer.address.number` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede/NumeroCivico` | BT-51 · 1.4.2.2 | Buyer street number |
| `buyer.address.postCode` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede/CAP` | BT-53 · 1.4.2.3 | Buyer post code |
| `buyer.address.city` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede/Comune` | BT-52 · 1.4.2.4 | Buyer city |
| `buyer.address.region` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede/Provincia` | BT-54 · 1.4.2.5 | Buyer province |
| `buyer.address.country` | `p:FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente/Sede/Nazione` | BT-55 · 1.4.2.6 | Buyer country code |
| `typeCode` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/TipoDocumento` | BT-3 · 2.1.1.1 | Document type (TD01-TD29) |
| `currency` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/Divisa` | BT-5 · 2.1.1.2 | Invoice currency code |
| `issueDate` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/Data` | BT-2 · 2.1.1.3 | Invoice issue date |
| `number` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/Numero` | BT-1 · 2.1.1.4 | Invoice number |
| `totals.taxInclusive` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/ImportoTotaleDocumento` | BT-112 · 2.1.1.9 | Document total amount (net of discount, inclusive of VAT charged to the buyer) |
| `totals.rounding` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/Arrotondamento` | BT-114 · 2.1.1.10 | Rounding amount |
| `note` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/Causale` | BT-22 · 2.1.1.11 | Invoice note |
| `references.purchaseOrder` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiOrdineAcquisto/IdDocumento` | BT-13 · 2.1.2.2 | Purchase order reference |
| `references.contract` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiContratto/IdDocumento` | BT-12 · 2.1.3.2 | Contract reference |
| `references.tenderOrLot` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiConvenzione/IdDocumento` | BT-17 · 2.1.4.2 | Tender or lot reference (convenzione, e.g. a Consip framework agreement) |
| `references.invoicedObject` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiRicezione/IdDocumento` | BT-18 · 2.1.5.2 | Invoiced object identifier (nearest FatturaPA slot: DatiRicezione, specs 1.9.1) |
| `references.precedingInvoice.number` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiFattureCollegate/IdDocumento` | BT-25 · 2.1.6.2 | Preceding invoice reference |
| `references.precedingInvoice.issueDate` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiFattureCollegate/Data` | BT-26 · 2.1.6.3 | Preceding invoice issue date |
| `references.despatchAdvice.number` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiDDT/NumeroDDT` | BT-16 · 2.1.8.1 | Despatch advice reference (numero del documento di trasporto) |
| `references.despatchAdvice.issueDate` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiDDT/DataDDT` | BT-16 · 2.1.8.2 | Despatch advice date - mandatory inside DatiDDT (XSD 1.2.3) |
| `it.bollo.virtuale` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/DatiBollo/BolloVirtuale` | 2.1.1.6.1 | Virtual stamp duty indicator (DPR 642/1972) |
| `it.bollo.amount` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiGeneraliDocumento/DatiBollo/ImportoBollo` | 2.1.1.6.2 | Stamp duty amount (marca da bollo, EUR 2.00) |
| `it.cup` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiOrdineAcquisto/CodiceCUP` | 2.1.2.6 | CUP - codice unitario progetto (L. 3/2003 art. 11) |
| `it.cig` | `p:FatturaElettronica/FatturaElettronicaBody/DatiGenerali/DatiOrdineAcquisto/CodiceCIG` | 2.1.2.7 | CIG - codice identificativo gara (L. 136/2010 art. 3) |
| `lines.{i}.id` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/NumeroLinea` | BT-126 · 2.2.1.1 | Invoice line identifier |
| `lines.{i}.name` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/Descrizione` | BT-153 · 2.2.1.4 | Item name |
| `lines.{i}.quantity` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/Quantita` | BT-129 · 2.2.1.5 | Invoiced quantity |
| `lines.{i}.unitCode` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/UnitaMisura` | BT-130 · 2.2.1.6 | Invoiced quantity unit of measure |
| `lines.{i}.unitPriceNet` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/PrezzoUnitario` | BT-146 · 2.2.1.9 | Item net price |
| `lines.{i}.netAmount` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/PrezzoTotale` | BT-131 · 2.2.1.11 | Invoice line net amount |
| `lines.{i}.vat.rate` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/AliquotaIVA` | BT-152 · 2.2.1.12 | Invoiced item VAT rate |
| `lines.{i}.vat.natura` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/Natura` | BT-151 · 2.2.1.14 | VAT nature code (N1-N7) |
| `lines.{i}.it.altriDatiGestionali.tipoDato` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/AltriDatiGestionali/TipoDato` | 2.2.1.16.1 | Management data type (e.g. INTENTO) |
| `lines.{i}.it.altriDatiGestionali.riferimentoTesto` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/AltriDatiGestionali/RiferimentoTesto` | 2.2.1.16.2 | Management data text reference |
| `lines.{i}.it.altriDatiGestionali.riferimentoNumero` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/AltriDatiGestionali/RiferimentoNumero` | 2.2.1.16.3 | Management data numeric reference |
| `lines.{i}.it.altriDatiGestionali.riferimentoData` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DettaglioLinee[{i}]/AltriDatiGestionali/RiferimentoData` | 2.2.1.16.4 | Management data date reference |
| `vatBreakdown.{i}.rate` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo[{i}]/AliquotaIVA` | BT-119 · 2.2.2.1 | VAT category rate |
| `vatBreakdown.{i}.natura` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo[{i}]/Natura` | BT-118 · 2.2.2.2 | VAT nature code (N1-N7) |
| `vatBreakdown.{i}.taxableAmount` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo[{i}]/ImponibileImporto` | BT-116 · 2.2.2.5 | VAT category taxable amount |
| `vatBreakdown.{i}.taxAmount` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo[{i}]/Imposta` | BT-117 · 2.2.2.6 | VAT category tax amount |
| `vatBreakdown.{i}.esigibilita` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo[{i}]/EsigibilitaIVA` | BT-8 · 2.2.2.7 | VAT chargeability (I/D/S) |
| `vatBreakdown.{i}.reason` | `p:FatturaElettronica/FatturaElettronicaBody/DatiBeniServizi/DatiRiepilogo[{i}]/RiferimentoNormativo` | BT-120 · 2.2.2.8 | VAT exemption reason text |
| `payment.conditions` | `p:FatturaElettronica/FatturaElettronicaBody/DatiPagamento/CondizioniPagamento` | 2.4.1 | Payment conditions (TP01/TP02/TP03) |
| `payment.accountName` | `p:FatturaElettronica/FatturaElettronicaBody/DatiPagamento/DettaglioPagamento/Beneficiario` | BT-85 · 2.4.2.1 | Payment account name |
| `payment.italianMeansCode` | `p:FatturaElettronica/FatturaElettronicaBody/DatiPagamento/DettaglioPagamento/ModalitaPagamento` | BT-81 · 2.4.2.2 | Payment means (MP01-MP23) |
| `dueDate` | `p:FatturaElettronica/FatturaElettronicaBody/DatiPagamento/DettaglioPagamento/DataScadenzaPagamento` | BT-9 · 2.4.2.5 | Payment due date |
| `totals.payable` | `p:FatturaElettronica/FatturaElettronicaBody/DatiPagamento/DettaglioPagamento/ImportoPagamento` | BT-115 · 2.4.2.6 | Amount due for payment |
| `payment.iban` | `p:FatturaElettronica/FatturaElettronicaBody/DatiPagamento/DettaglioPagamento/IBAN` | BT-84 · 2.4.2.13 | Payment account identifier (IBAN) |
| `payment.bic` | `p:FatturaElettronica/FatturaElettronicaBody/DatiPagamento/DettaglioPagamento/BIC` | BT-86 · 2.4.2.16 | Payment service provider identifier (BIC) |

## fiskaly JSON operation (`TRANSACTION::INVOICE`)

The operation is composed by `toInvoiceTransaction` (`frontend/src/uapi-map.ts`); most model
fields map structurally in code rather than through a row table. The tables here are the
declared *extras and exceptions*: UAPI-only fields, and what the operation cannot carry.

### UAPI-only fields (operation pointer → model field)

Fields that exist because the operation offers them, addressed by JSON Pointer (`{i}` = any
array index):

| Operation pointer | Model field |
| --- | --- |
| `/document/series` | `uapi.series` |
| `/document/activity_code` | `uapi.activityCode` |
| `/document/operation_date` | `uapi.operationDate` |
| `/document/references/buyer_routing` | `uapi.buyerAccountingRef` |
| `/entries/{i}/data/value/discount` | `lines.{i}.uapi.allowance` |
| `/entries/{i}/data/value/surcharge` | `lines.{i}.uapi.surcharge` |
| `/entries/{i}/data/product/number` | `lines.{i}.uapi.itemNumber` |
| `/entries/{i}/data/product/code` | `lines.{i}.uapi.itemCode` |
| `/entries/{i}/details/purpose` | `lines.{i}.uapi.purpose` |
| `/entries/{i}/details/regulatory` | `lines.{i}.uapi.regulatory` |
| `/entries/{i}/details/label` | `lines.{i}.uapi.label` |
| `/recipients/{i}/buyer_id` | `uapi.buyer.buyerId` |
| `/recipients/{i}/origin` | `uapi.buyer.origin` |
| `/recipients/{i}/shipping/name` | `uapi.delivery.name` |
| `/recipients/{i}/shipping/address/line/street` | `uapi.delivery.address.street` |
| `/recipients/{i}/shipping/address/line/number` | `uapi.delivery.address.number` |
| `/recipients/{i}/shipping/address/city` | `uapi.delivery.address.city` |
| `/recipients/{i}/shipping/address/code` | `uapi.delivery.address.postCode` |
| `/recipients/{i}/shipping/address/region` | `uapi.delivery.address.region` |
| `/recipients/{i}/shipping/address/country` | `uapi.delivery.address.country` |
| `/recipients/{i}/shipping/date` | `delivery.date` |
| `/document/number` | `number` |
| `/document/text` | `note` |
| `/payments/{i}/type` | `payment.meansCode` |
| `/payments/{i}/name` | `payment.meansText` |
| `/document/issued_at` | `issueDate` |
| `/document/payment_terms` | `payment.terms` |
| `/document/references/buyer` | `references.buyerReference` |
| `/document/references/project` | `references.project` |
| `/document/references/contract` | `references.contract` |
| `/document/references/purchase_order` | `references.purchaseOrder` |
| `/document/references/despatch_advice` | `references.despatchAdvice.number` |
| `/document/references/tender` | `references.tenderOrLot` |
| `/document/references/preceding_document/number` | `references.precedingInvoice.number` |
| `/document/references/preceding_document/issued_at` | `references.precedingInvoice.issueDate` |
| `/entries/{i}/data/text` | `lines.{i}.name` |
| `/entries/{i}/data/unit/quantity` | `lines.{i}.quantity` |
| `/entries/{i}/data/unit/measure` | `lines.{i}.unitCode` |
| `/entries/{i}/data/unit/price/exclusive` | `lines.{i}.unitPriceNet` |
| `/entries/{i}/data/value/base` | `lines.{i}.netAmount` |
| `/entries/{i}/data/vat/code` | `lines.{i}.vat.category` |
| `/entries/{i}/data/vat/percentage` | `lines.{i}.vat.rate` |
| `/entries/{i}/data/vat/reason` | `lines.{i}.vat.reason` |
| `/entries/{i}/details/description` | `lines.{i}.description` |
| `/entries/{i}/details/number` | `lines.{i}.id` |
| `/recipients/{i}/name` | `buyer.name` |
| `/recipients/{i}/name/forename` | `buyer.person.forename` |
| `/recipients/{i}/name/surname` | `buyer.person.surname` |
| `/recipients/{i}/name/gender` | `buyer.person.gender` |
| `/recipients/{i}/company_id` | `buyer.legalRegId` |
| `/recipients/{i}/identification/number` | `buyer.vatId` |
| `/recipients/{i}/address/line/street` | `buyer.address.street` |
| `/recipients/{i}/address/line/number` | `buyer.address.number` |
| `/recipients/{i}/address/city` | `buyer.address.city` |
| `/recipients/{i}/address/code` | `buyer.address.postCode` |
| `/recipients/{i}/address/region` | `buyer.address.region` |
| `/recipients/{i}/address/country` | `buyer.address.country` |
| `/recipients/{i}/invoicing/destination_code` | `buyer.channel.codiceDestinatario` |
| `/recipients/{i}/invoicing/pec` | `buyer.channel.pec` |
| `/recipients/{i}/invoicing/identifier` | `buyer.channel.participantId` |
| `/recipients/{i}/invoicing/email` | `buyer.channel.email` |
| `/recipients/{i}/invoicing/format` | `buyer.channel.format` |
| `/payments/{i}/details/amount` | `totals.payable` |
| `/payments/{i}/details/currency` | `currency` |
| `/payments/{i}/details/date` | `dueDate` |
| `/payments/{i}/instruction/account` | `payment.iban` |
| `/payments/{i}/instruction/name` | `payment.accountName` |
| `/payments/{i}/instruction/payment_service_provider` | `payment.bic` |
| `/payments/{i}/instruction/text` | `payment.remittanceInformation` |
| `/breakdown/{i}/code` | `vatBreakdown.{i}.category` |
| `/breakdown/{i}/percentage` | `vatBreakdown.{i}.rate` |
| `/breakdown/{i}/amount` | `vatBreakdown.{i}.taxAmount` |
| `/breakdown/{i}/exclusive` | `vatBreakdown.{i}.taxableAmount` |
| `/totals/vat/amount` | `totals.taxAmount` |
| `/totals/vat/exclusive` | `totals.taxExclusive` |
| `/totals/vat/inclusive` | `totals.taxInclusive` |
| `/seller/name` | `seller.contact.name` |
| `/seller/phone` | `seller.contact.phone` |
| `/seller/email` | `seller.contact.email` |

### Lossy: model fields the operation cannot carry at all

| Reason (verbatim from the loss table) | Model fields |
| --- | --- |
| The syntax is chosen by fiskaly from the recipient's channel and the taxpayer's country, not by the operation | `format` |
| BT-3 is derived by fiskaly; the operation only distinguishes INVOICE from CORRECTION | `typeCode` |
| document.references carries neither BT-14 nor BT-18, and despatch_advice is a bare number without BT-16's date | `references.salesOrder`, `references.invoicedObject`, `references.despatchAdvice.issueDate` |
| The Italian document extras (bollo virtuale, CUP, CIG) have no counterpart in the operation | `it.bollo.virtuale`, `it.bollo.amount`, `it.cup`, `it.cig` |
| The seller (BG-4) comes from the taxpayer resource; the operation carries only the contact point (BG-6) | `seller.name`, `seller.tradeName`, `seller.person.forename`, `seller.person.surname`, `seller.person.gender`, `seller.vatId`, `seller.taxId`, `seller.legalRegId`, `seller.legalRegScheme`, `seller.electronicAddress.scheme`, `seller.electronicAddress.id`, `seller.address.street`, `seller.address.number`, `seller.address.city`, `seller.address.postCode`, `seller.address.region`, `seller.address.country`, `seller.it.regimeFiscale`, `seller.it.rea.office`, `seller.it.rea.number`, `seller.it.rea.capital`, `seller.it.rea.soleShareholder`, `seller.it.rea.liquidation` |
| BusinessRecipient has no trading name, no ISO 6523 scheme for company_id and no contact group | `buyer.tradeName`, `buyer.legalRegScheme`, `buyer.contact.name`, `buyer.contact.phone`, `buyer.contact.email` |
| rateCode/exemptionCode are many-to-one: the SystemVatRateCode and SystemVatExemptionCode enums cannot express Natura or a VATEX code | `lines.{i}.vat.natura`, `lines.{i}.vat.vatexCode`, `vatBreakdown.{i}.natura`, `vatBreakdown.{i}.vatexCode` |
| esigibilita (FatturaPA EsigibilitaIVA) has no counterpart in the VAT breakdown | `vatBreakdown.{i}.esigibilita` |
| AltriDatiGestionali has no counterpart in the operation | `lines.{i}.it.altriDatiGestionali.tipoDato`, `lines.{i}.it.altriDatiGestionali.riferimentoTesto`, `lines.{i}.it.altriDatiGestionali.riferimentoNumero`, `lines.{i}.it.altriDatiGestionali.riferimentoData` |
| The payment instruction is a bank transfer or nothing; ModalitaPagamento and the FatturaPA payment conditions are not carried | `payment.italianMeansCode`, `payment.conditions` |
| totals.vat is a three-value VAT summary; the EN 16931 document-level sums and adjustments are not carried | `totals.lineExtension`, `totals.allowance`, `totals.charge`, `totals.prepaid`, `totals.rounding` |

### Partial: model fields the operation carries incompletely

| Reason (verbatim from the loss table) | Model fields |
| --- | --- |
| Only a VAT_RATE row has a percentage; an exemption or reverse-charge row carries none | `lines.{i}.vat.rate`, `vatBreakdown.{i}.rate` |
| identification names one identifier, so a buyer with a VAT id sends only that; its codice fiscale is preserved but not editable through the JSON | `buyer.taxId` |
| Only a CONSUMER recipient carries a PersonName; a BUSINESS recipient has one legal name and no forename, surname or gender | `buyer.person.forename`, `buyer.person.surname`, `buyer.person.gender` |
| The bank details only travel inside a CREDIT_TRANSFER instruction | `payment.iban`, `payment.accountName`, `payment.bic` |
| details.number is optional; without it the entry's position becomes the line id | `lines.{i}.id` |
| BT-72 only travels inside recipients[].shipping, which requires BG-15: without a delivery address there is nowhere to put it | `delivery.date` |

## Field fates (FatturaPA gateway evidence)

What fiskaly's gateway actually did with each operation field in the captured exchange of
2026-08-25 (`docs/reference/fatturapa/`). Scope: the Italian path only; a pointer that is
absent here means *no evidence*, never *safe*. Fates: **mapped** reaches the XML ·
**not-rendered** produces no element · **discarded** accepted then thrown away ·
**platform** comes from the Taxpayer/System entity, not from the payload.

| Operation pointer | Fate | XML element | Evidence note |
| --- | --- | --- | --- |
| `/recipients/{i}/invoicing/destination_code` | **mapped** | `DatiTrasmissione/CodiceDestinatario` | The SDI destination code is written to CodiceDestinatario; the rest of the transmission envelope (IdTrasmittente, ProgressivoInvio, FormatoTrasmissione) is generated by the platform and cannot be authored from the request. |
| `/seller` | **platform** | `CedentePrestatore` | The seller's identity, address, RegimeFiscale and IscrizioneREA come from the commissioned Taxpayer entity, not from this request; only the phone and email in this block reach the XML, as the contact point. |
| `/seller/name` | **not-rendered** | — | Accepted by the schema (BT-41 seller contact point) but FatturaPA's Contatti block has no name element, so it produced no output in the tested capture. |
| `/seller/phone` | **mapped** | `CedentePrestatore/Contatti/Telefono` | The seller phone becomes Contatti/Telefono; the tested capture shows it reformatted (+39123456789 came back as 123456789). |
| `/seller/email` | **mapped** | `CedentePrestatore/Contatti/Email` | The seller email becomes Contatti/Email, unchanged in the tested capture. |
| `/tax_representative` | **not-rendered** | — | Accepted by the schema, but no RappresentanteFiscale block appeared in the tested capture even though the request named one. |
| `/recipients/{i}/name` | **mapped** | `CessionarioCommittente/DatiAnagrafici/Anagrafica/Denominazione` | The business recipient's name becomes the buyer's Denominazione. |
| `/recipients/{i}/identification/number` | **mapped** | `CessionarioCommittente/DatiAnagrafici/IdFiscaleIVA/IdCodice` | A VAT identification becomes the buyer's IdFiscaleIVA, written as the bare national number without the IT prefix. |
| `/recipients/{i}/address` | **mapped** | `CessionarioCommittente/Sede` | The recipient address becomes the buyer's Sede: street, number, postcode, city, region (Provincia) and country all rendered in the tested capture. |
| `/recipients/{i}/buyer_id` | **not-rendered** | — | Accepted by the schema (BT-46 buyer identifier) but produced no element in the tested capture. |
| `/recipients/{i}/company_id` | **not-rendered** | — | We send the buyer's legal registration number here (BT-47); the schema accepts it and the tested capture shows no element for it. It stays in the payload because this evidence covers FatturaPA only — other syntaxes may render it. |
| `/recipients/{i}/shipping` | **not-rendered** | — | Accepted by the schema, but no DatiTrasporto block appeared in the tested capture even though the request carried a full shipping address and date. |
| `/document/number` | **mapped** | `DatiGeneraliDocumento/Numero` | The document number becomes Numero, unchanged. |
| `/document/issued_at` | **mapped** | `DatiGeneraliDocumento/Data` | The issue date becomes Data (BT-2). The 2026-06-01 spec requires only document.number, and the tested capture — which omitted issued_at — shows Data platform-defaulted to the transmission date; we always send it so the issue date stays author-controlled. |
| `/document/payment_terms` | **not-rendered** | — | The tested payload sent free-text payment terms and no element carried them; FatturaPA expresses terms as the coded CondizioniPagamento, which the platform derives itself. |
| `/document/references/purchase_order` | **mapped** | `DatiGenerali/DatiOrdineAcquisto` | The purchase order reference becomes DatiOrdineAcquisto/IdDocumento. |
| `/document/references/contract` | **mapped** | `DatiGenerali/DatiContratto` | The contract reference becomes DatiContratto/IdDocumento. |
| `/document/references/tender` | **mapped** | `DatiGenerali/DatiConvenzione` | The tender reference becomes DatiConvenzione/IdDocumento. |
| `/document/references/preceding_document` | **mapped** | `DatiGenerali/DatiFattureCollegate` | The preceding document becomes DatiFattureCollegate, with both IdDocumento and Data rendered in the tested capture. |
| `/document/references/buyer` | **not-rendered** | — | Accepted by the schema (BT-10 buyer reference) but produced no element in the tested capture. |
| `/document/references/buyer_routing` | **not-rendered** | — | Accepted by the schema (BT-19 buyer accounting reference) but produced no element in the tested capture. |
| `/entries/{i}/data/text` | **mapped** | `DettaglioLinee/Descrizione` | The entry text (BT-153 item name) becomes the line's Descrizione. |
| `/entries/{i}/data/unit/quantity` | **mapped** | `DettaglioLinee/Quantita` | The quantity becomes Quantita, reformatted by the gateway (1 came back as 1.00000000 in the tested capture). |
| `/entries/{i}/data/unit/measure` | **not-rendered** | — | Free text in the 2026-06-01 spec (BT-130, PlainString32); the tested capture sent "unit" and no UnitaMisura element appeared. We send UN/ECE Rec 20 codes such as C62, which are equally schema-valid; whether a recognised code would render UnitaMisura is unproven. |
| `/entries/{i}/data/unit/price/exclusive` | **mapped** | `DettaglioLinee/PrezzoUnitario` | The net unit price becomes PrezzoUnitario, reformatted by the gateway (100.00 came back as 100.0000 in the tested capture). |
| `/entries/{i}/data/value/base` | **mapped** | `DettaglioLinee/PrezzoTotale` | The entry's base value becomes the line's PrezzoTotale. |
| `/entries/{i}/data/vat/percentage` | **mapped** | `DettaglioLinee/AliquotaIVA` | The VAT percentage becomes the line's AliquotaIVA. |
| `/entries/{i}/data/product` | **discarded** | — | Accepted by the schema, then thrown away by the FatturaPA generator; no product details reach the XML. |
| `/entries/{i}/details/concept` | **not-rendered** | — | The one details field the generator keeps — it classifies the entry as GOOD or SERVICE — but no FatturaPA element depends on it in the tested capture. We derive it from the unit code (HUR means SERVICE), which matched the tested consulting line. |
| `/entries/{i}/details/description` | **discarded** | — | We send the line description here (BT-127 invoice line note) and the FatturaPA generator throws it away — only `concept` survives from the details block. It stays in the payload because the schema accepts it and this evidence does not cover the UBL and CII paths, which may use it. |
| `/entries/{i}/details/number` | **discarded** | — | We send the line id here and the FatturaPA generator throws it away; NumeroLinea is assigned from the entry's position instead. It stays in the payload because the schema accepts it and this evidence covers FatturaPA only. |
| `/entries/{i}/details/purpose` | **discarded** | — | Accepted by the schema, then thrown away by the FatturaPA generator — only `concept` survives from the details block. |
| `/entries/{i}/details/regulatory` | **discarded** | — | Accepted by the schema, then thrown away by the FatturaPA generator — only `concept` survives from the details block. |
| `/entries/{i}/details/label` | **discarded** | — | Accepted by the schema, then thrown away by the FatturaPA generator — only `concept` survives from the details block. |
| `/entries/{i}/details/properties` | **discarded** | — | Accepted by the schema, then thrown away by the FatturaPA generator — only `concept` survives from the details block. |
| `/breakdown` | **discarded** | `DatiBeniServizi/DatiRiepilogo` | The VAT breakdown you send is thrown away — DatiRiepilogo is always recomputed server-side from the lines. The 2026-06-01 spec still requires it on an INVOICE operation, so it must be sent even though it is ignored; both statements are true at once. |
| `/totals` | **discarded** | `DatiBeniServizi/DatiRiepilogo` | The totals you send are thrown away and recomputed server-side along with DatiRiepilogo. The 2026-06-01 spec still requires it on an INVOICE operation, so it must be sent even though it is ignored; both statements are true at once. |
| `/payments/{i}/details/amount` | **mapped** | `DettaglioPagamento/ImportoPagamento` | The payment amount becomes ImportoPagamento. |
| `/payments/{i}/details/currency` | **mapped** | `DatiGeneraliDocumento/Divisa` | The document currency (Divisa) is taken from the payment details. |
| `/payments/{i}/details/date` | **mapped** | `DettaglioPagamento/DataScadenzaPagamento` | The payment date on an OUTSTANDING payment becomes DataScadenzaPagamento. |
| `/payments/{i}/details/discount` | **discarded** | — | Accepted by the schema, then thrown away by the FatturaPA generator; no payment discount reaches the XML. |
| `/payments/{i}/concept` | **discarded** | — | Accepted by the schema (GOOD, SERVICE or INVOICE), then thrown away by the FatturaPA generator; the tested capture sent SERVICE and we send INVOICE, and neither reaches the XML. |
| `/payments/{i}/instruction/account` | **mapped** | `DettaglioPagamento/IBAN` | The credit-transfer account becomes the IBAN element. |
| `/payments/{i}/instruction/name` | **mapped** | `DettaglioPagamento/IstitutoFinanziario` | The instruction's account-holder name is written as IstitutoFinanziario — FatturaPA's financial-institution name — exactly as observed in the tested capture. |
| `/payments/{i}/instruction/payment_service_provider` | **mapped** | `DettaglioPagamento/BIC` | The payment service provider becomes the BIC element and must be a real SWIFT/BIC. |
| `/payments/{i}/instruction/type` | **platform** | `DettaglioPagamento/ModalitaPagamento` | The request has no field for ModalitaPagamento; the platform derives a default (MP05, bank transfer, in the tested capture), so the model's payment.italianMeansCode cannot influence the XML. |
| `/payments/{i}/type` | **platform** | `DatiPagamento/CondizioniPagamento` | The request has no field for CondizioniPagamento; the platform derives a default (TP02, full payment, in the tested capture), so the model's payment.conditions cannot influence the XML. |
