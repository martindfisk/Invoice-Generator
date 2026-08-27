import type { MappingRow } from "./model";

export const UBL_NAMESPACES: Record<string, string> = {
  xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
};

export const UBL_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

export const UBL_PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

export const UBL_TAX_SCHEME = "VAT";

export const UBL_INVOICED_OBJECT_TYPE_CODE = "130";

const SUPPLIER = "Invoice/cac:AccountingSupplierParty/cac:Party";
const CUSTOMER = "Invoice/cac:AccountingCustomerParty/cac:Party";
const TAX_SUBTOTAL = "Invoice/cac:TaxTotal/cac:TaxSubtotal[{i}]";
const TOTAL = "Invoice/cac:LegalMonetaryTotal";
const LINE = "Invoice/cac:InvoiceLine[{i}]";
const MEANS = "Invoice/cac:PaymentMeans";
const DELIVERY = "Invoice/cac:Delivery";

export const UBL_MAP: MappingRow[] = [
  {
    field: "",
    path: "Invoice/cbc:CustomizationID",
    bt: "BT-24",
    label: "Specification identifier (Peppol BIS Billing 3.0)",
  },
  {
    field: "",
    path: "Invoice/cbc:ProfileID",
    bt: "BT-23",
    label: "Business process type (Peppol BIS Billing 3.0)",
  },
  { field: "number", path: "Invoice/cbc:ID", bt: "BT-1", label: "Invoice number" },
  { field: "issueDate", path: "Invoice/cbc:IssueDate", bt: "BT-2", label: "Invoice issue date" },
  { field: "dueDate", path: "Invoice/cbc:DueDate", bt: "BT-9", label: "Payment due date" },
  {
    field: "typeCode",
    path: "Invoice/cbc:InvoiceTypeCode",
    bt: "BT-3",
    label: "Invoice type code (UNCL1001)",
  },
  { field: "note", path: "Invoice/cbc:Note", bt: "BT-22", label: "Invoice note" },
  {
    field: "currency",
    path: "Invoice/cbc:DocumentCurrencyCode",
    bt: "BT-5",
    label: "Invoice currency code (ISO 4217)",
  },
  {
    field: "references.buyerReference",
    path: "Invoice/cbc:BuyerReference",
    bt: "BT-10",
    label: "Buyer reference",
  },
  {
    field: "references.purchaseOrder",
    path: "Invoice/cac:OrderReference/cbc:ID",
    bt: "BT-13",
    label: "Purchase order reference",
  },
  {
    field: "references.salesOrder",
    path: "Invoice/cac:OrderReference/cbc:SalesOrderID",
    bt: "BT-14",
    label: "Sales order reference",
  },
  {
    field: "references.precedingInvoice.number",
    path: "Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID",
    bt: "BT-25",
    label: "Preceding invoice reference",
  },
  {
    field: "references.precedingInvoice.issueDate",
    path: "Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate",
    bt: "BT-26",
    label: "Preceding invoice issue date",
  },
  {
    field: "references.despatchAdvice.number",
    path: "Invoice/cac:DespatchDocumentReference/cbc:ID",
    bt: "BT-16",
    label: "Despatch advice reference",
  },
  {
    field: "references.tenderOrLot",
    path: "Invoice/cac:OriginatorDocumentReference/cbc:ID",
    bt: "BT-17",
    label: "Tender or lot reference",
  },
  {
    field: "references.contract",
    path: "Invoice/cac:ContractDocumentReference/cbc:ID",
    bt: "BT-12",
    label: "Contract reference",
  },
  {
    field: "references.invoicedObject",
    path: "Invoice/cac:AdditionalDocumentReference/cbc:ID",
    bt: "BT-18",
    label: "Invoiced object identifier",
  },
  {
    field: "",
    path: "Invoice/cac:AdditionalDocumentReference/cbc:DocumentTypeCode",
    bt: "BT-18",
    label: "Invoiced object document type code (UNCL1001 130, EN 16931 UBL binding)",
  },
  {
    field: "references.project",
    path: "Invoice/cac:ProjectReference/cbc:ID",
    bt: "BT-11",
    label: "Project reference",
  },

  {
    field: "seller.electronicAddress.id",
    path: `${SUPPLIER}/cbc:EndpointID`,
    bt: "BT-34",
    label: "Seller electronic address",
  },
  {
    field: "seller.electronicAddress.scheme",
    path: `${SUPPLIER}/cbc:EndpointID/@schemeID`,
    bt: "BT-34-1",
    label: "Seller electronic address scheme (EAS)",
  },
  {
    field: "seller.tradeName",
    path: `${SUPPLIER}/cac:PartyName/cbc:Name`,
    bt: "BT-28",
    label: "Seller trading name",
  },
  {
    field: "seller.address.street",
    path: `${SUPPLIER}/cac:PostalAddress/cbc:StreetName`,
    bt: "BT-35",
    label: "Seller address line 1",
  },
  {
    field: "seller.address.number",
    path: `${SUPPLIER}/cac:PostalAddress/cbc:AdditionalStreetName`,
    bt: "BT-36",
    label: "Seller address line 2",
  },
  {
    field: "seller.address.city",
    path: `${SUPPLIER}/cac:PostalAddress/cbc:CityName`,
    bt: "BT-37",
    label: "Seller city",
  },
  {
    field: "seller.address.postCode",
    path: `${SUPPLIER}/cac:PostalAddress/cbc:PostalZone`,
    bt: "BT-38",
    label: "Seller post code",
  },
  {
    field: "seller.address.region",
    path: `${SUPPLIER}/cac:PostalAddress/cbc:CountrySubentity`,
    bt: "BT-39",
    label: "Seller country subdivision",
  },
  {
    field: "seller.address.country",
    path: `${SUPPLIER}/cac:PostalAddress/cac:Country/cbc:IdentificationCode`,
    bt: "BT-40",
    label: "Seller country code (ISO 3166-1 alpha-2)",
  },
  {
    field: "seller.vatId",
    path: `${SUPPLIER}/cac:PartyTaxScheme/cbc:CompanyID`,
    bt: "BT-31",
    label: "Seller VAT identifier",
  },
  {
    field: "seller.name",
    path: `${SUPPLIER}/cac:PartyLegalEntity/cbc:RegistrationName`,
    bt: "BT-27",
    label: "Seller name",
  },
  {
    field: "seller.legalRegId",
    path: `${SUPPLIER}/cac:PartyLegalEntity/cbc:CompanyID`,
    bt: "BT-30",
    label: "Seller legal registration identifier",
  },
  {
    field: "seller.legalRegScheme",
    path: `${SUPPLIER}/cac:PartyLegalEntity/cbc:CompanyID/@schemeID`,
    bt: "BT-30-1",
    label: "Seller legal registration scheme (ISO 6523 ICD)",
  },
  {
    field: "seller.contact.name",
    path: `${SUPPLIER}/cac:Contact/cbc:Name`,
    bt: "BT-41",
    label: "Seller contact point",
  },
  {
    field: "seller.contact.phone",
    path: `${SUPPLIER}/cac:Contact/cbc:Telephone`,
    bt: "BT-42",
    label: "Seller contact telephone number",
  },
  {
    field: "seller.contact.email",
    path: `${SUPPLIER}/cac:Contact/cbc:ElectronicMail`,
    bt: "BT-43",
    label: "Seller contact email address",
  },

  {
    field: "buyer.electronicAddress.id",
    path: `${CUSTOMER}/cbc:EndpointID`,
    bt: "BT-49",
    label: "Buyer electronic address",
  },
  {
    field: "buyer.electronicAddress.scheme",
    path: `${CUSTOMER}/cbc:EndpointID/@schemeID`,
    bt: "BT-49-1",
    label: "Buyer electronic address scheme (EAS)",
  },
  {
    field: "buyer.tradeName",
    path: `${CUSTOMER}/cac:PartyName/cbc:Name`,
    bt: "BT-45",
    label: "Buyer trading name",
  },
  {
    field: "buyer.address.street",
    path: `${CUSTOMER}/cac:PostalAddress/cbc:StreetName`,
    bt: "BT-50",
    label: "Buyer address line 1",
  },
  {
    field: "buyer.address.number",
    path: `${CUSTOMER}/cac:PostalAddress/cbc:AdditionalStreetName`,
    bt: "BT-51",
    label: "Buyer address line 2",
  },
  {
    field: "buyer.address.city",
    path: `${CUSTOMER}/cac:PostalAddress/cbc:CityName`,
    bt: "BT-52",
    label: "Buyer city",
  },
  {
    field: "buyer.address.postCode",
    path: `${CUSTOMER}/cac:PostalAddress/cbc:PostalZone`,
    bt: "BT-53",
    label: "Buyer post code",
  },
  {
    field: "buyer.address.region",
    path: `${CUSTOMER}/cac:PostalAddress/cbc:CountrySubentity`,
    bt: "BT-54",
    label: "Buyer country subdivision",
  },
  {
    field: "buyer.address.country",
    path: `${CUSTOMER}/cac:PostalAddress/cac:Country/cbc:IdentificationCode`,
    bt: "BT-55",
    label: "Buyer country code (ISO 3166-1 alpha-2)",
  },
  {
    field: "buyer.vatId",
    path: `${CUSTOMER}/cac:PartyTaxScheme/cbc:CompanyID`,
    bt: "BT-48",
    label: "Buyer VAT identifier",
  },
  {
    field: "buyer.name",
    path: `${CUSTOMER}/cac:PartyLegalEntity/cbc:RegistrationName`,
    bt: "BT-44",
    label: "Buyer name",
  },
  {
    field: "buyer.legalRegId",
    path: `${CUSTOMER}/cac:PartyLegalEntity/cbc:CompanyID`,
    bt: "BT-47",
    label: "Buyer legal registration identifier",
  },
  {
    field: "buyer.legalRegScheme",
    path: `${CUSTOMER}/cac:PartyLegalEntity/cbc:CompanyID/@schemeID`,
    bt: "BT-47-1",
    label: "Buyer legal registration scheme (ISO 6523 ICD)",
  },
  {
    field: "buyer.contact.name",
    path: `${CUSTOMER}/cac:Contact/cbc:Name`,
    bt: "BT-56",
    label: "Buyer contact point",
  },
  {
    field: "buyer.contact.phone",
    path: `${CUSTOMER}/cac:Contact/cbc:Telephone`,
    bt: "BT-57",
    label: "Buyer contact telephone number",
  },
  {
    field: "buyer.contact.email",
    path: `${CUSTOMER}/cac:Contact/cbc:ElectronicMail`,
    bt: "BT-58",
    label: "Buyer contact email address",
  },

  {
    field: "delivery.date",
    path: `${DELIVERY}/cbc:ActualDeliveryDate`,
    bt: "BT-72",
    label: "Actual delivery date",
  },

  {
    field: "payment.meansCode",
    path: `${MEANS}/cbc:PaymentMeansCode`,
    bt: "BT-81",
    label: "Payment means type code (UNCL4461)",
  },
  {
    field: "payment.meansText",
    path: `${MEANS}/cbc:PaymentMeansCode/@name`,
    bt: "BT-82",
    label: "Payment means text",
  },
  {
    field: "payment.remittanceInformation",
    path: `${MEANS}/cbc:PaymentID`,
    bt: "BT-83",
    label: "Remittance information",
  },
  {
    field: "payment.iban",
    path: `${MEANS}/cac:PayeeFinancialAccount/cbc:ID`,
    bt: "BT-84",
    label: "Payment account identifier (IBAN)",
  },
  {
    field: "payment.accountName",
    path: `${MEANS}/cac:PayeeFinancialAccount/cbc:Name`,
    bt: "BT-85",
    label: "Payment account name",
  },
  {
    field: "payment.bic",
    path: `${MEANS}/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID`,
    bt: "BT-86",
    label: "Payment service provider identifier (BIC)",
  },
  {
    field: "payment.terms",
    path: "Invoice/cac:PaymentTerms/cbc:Note",
    bt: "BT-20",
    label: "Payment terms",
  },

  {
    field: "totals.taxAmount",
    path: "Invoice/cac:TaxTotal/cbc:TaxAmount",
    bt: "BT-110",
    label: "Invoice total VAT amount",
  },
  {
    field: "vatBreakdown.{i}.taxableAmount",
    path: `${TAX_SUBTOTAL}/cbc:TaxableAmount`,
    bt: "BT-116",
    label: "VAT category taxable amount",
  },
  {
    field: "vatBreakdown.{i}.taxAmount",
    path: `${TAX_SUBTOTAL}/cbc:TaxAmount`,
    bt: "BT-117",
    label: "VAT category tax amount",
  },
  {
    field: "vatBreakdown.{i}.category",
    path: `${TAX_SUBTOTAL}/cac:TaxCategory/cbc:ID`,
    bt: "BT-118",
    label: "VAT category code (UNCL5305)",
  },
  {
    field: "vatBreakdown.{i}.rate",
    path: `${TAX_SUBTOTAL}/cac:TaxCategory/cbc:Percent`,
    bt: "BT-119",
    label: "VAT category rate",
  },
  {
    field: "vatBreakdown.{i}.vatexCode",
    path: `${TAX_SUBTOTAL}/cac:TaxCategory/cbc:TaxExemptionReasonCode`,
    bt: "BT-121",
    label: "VAT exemption reason code (VATEX)",
  },
  {
    field: "vatBreakdown.{i}.reason",
    path: `${TAX_SUBTOTAL}/cac:TaxCategory/cbc:TaxExemptionReason`,
    bt: "BT-120",
    label: "VAT exemption reason text",
  },

  {
    field: "totals.lineExtension",
    path: `${TOTAL}/cbc:LineExtensionAmount`,
    bt: "BT-106",
    label: "Sum of invoice line net amounts",
  },
  {
    field: "totals.taxExclusive",
    path: `${TOTAL}/cbc:TaxExclusiveAmount`,
    bt: "BT-109",
    label: "Invoice total amount without VAT",
  },
  {
    field: "totals.taxInclusive",
    path: `${TOTAL}/cbc:TaxInclusiveAmount`,
    bt: "BT-112",
    label: "Invoice total amount with VAT",
  },
  {
    field: "totals.allowance",
    path: `${TOTAL}/cbc:AllowanceTotalAmount`,
    bt: "BT-107",
    label: "Sum of allowances on document level",
  },
  {
    field: "totals.charge",
    path: `${TOTAL}/cbc:ChargeTotalAmount`,
    bt: "BT-108",
    label: "Sum of charges on document level",
  },
  {
    field: "totals.prepaid",
    path: `${TOTAL}/cbc:PrepaidAmount`,
    bt: "BT-113",
    label: "Paid amount",
  },
  {
    field: "totals.rounding",
    path: `${TOTAL}/cbc:PayableRoundingAmount`,
    bt: "BT-114",
    label: "Rounding amount",
  },
  {
    field: "totals.payable",
    path: `${TOTAL}/cbc:PayableAmount`,
    bt: "BT-115",
    label: "Amount due for payment",
  },

  { field: "lines.{i}.id", path: `${LINE}/cbc:ID`, bt: "BT-126", label: "Invoice line identifier" },
  {
    field: "lines.{i}.quantity",
    path: `${LINE}/cbc:InvoicedQuantity`,
    bt: "BT-129",
    label: "Invoiced quantity",
  },
  {
    field: "lines.{i}.unitCode",
    path: `${LINE}/cbc:InvoicedQuantity/@unitCode`,
    bt: "BT-130",
    label: "Invoiced quantity unit of measure (UN/ECE Rec 20)",
  },
  {
    field: "lines.{i}.netAmount",
    path: `${LINE}/cbc:LineExtensionAmount`,
    bt: "BT-131",
    label: "Invoice line net amount",
  },
  {
    field: "lines.{i}.description",
    path: `${LINE}/cac:Item/cbc:Description`,
    bt: "BT-154",
    label: "Item description",
  },
  { field: "lines.{i}.name", path: `${LINE}/cac:Item/cbc:Name`, bt: "BT-153", label: "Item name" },
  {
    field: "lines.{i}.vat.category",
    path: `${LINE}/cac:Item/cac:ClassifiedTaxCategory/cbc:ID`,
    bt: "BT-151",
    label: "Invoiced item VAT category code",
  },
  {
    field: "lines.{i}.vat.rate",
    path: `${LINE}/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent`,
    bt: "BT-152",
    label: "Invoiced item VAT rate",
  },
  {
    field: "lines.{i}.unitPriceNet",
    path: `${LINE}/cac:Price/cbc:PriceAmount`,
    bt: "BT-146",
    label: "Item net price",
  },
];

export function ublRow(field: string): MappingRow {
  const row = UBL_MAP.find((candidate) => candidate.field === field);
  if (!row) throw new Error(`ubl-map: no row for field "${field}"`);
  return row;
}

export function ublConstantRow(bt: string): MappingRow {
  const row = UBL_MAP.find((candidate) => candidate.field === "" && candidate.bt === bt);
  if (!row) throw new Error(`ubl-map: no constant row for ${bt}`);
  return row;
}
