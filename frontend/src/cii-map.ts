import type { MappingRow } from "./model";

export const CII_NAMESPACES: Record<string, string> = {
  "xmlns:rsm": "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100",
  "xmlns:qdt": "urn:un:unece:uncefact:data:standard:QualifiedDataType:100",
  "xmlns:ram": "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100",
  "xmlns:udt": "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100",
};

export const CII_GUIDELINE_ID = "urn:cen.eu:en16931:2017";

export const CII_SPEC =
  "EN 16931-1:2017 / UN/CEFACT CII D16B (CEN/TS 16931-3-3); " +
  "Factur-X 1.08 / ZUGFeRD 2.4 profile EN 16931 (urn:cen.eu:en16931:2017)";

export const CII_TAX_TYPE_CODE = "VAT";

export const CII_DATE_FORMAT = "102";

export const CII_VAT_SCHEME_ID = "VA";

export const CII_TAX_SCHEME_ID = "FC";

export const CII_TENDER_TYPE_CODE = "50";

export const CII_INVOICED_OBJECT_TYPE_CODE = "130";

const ROOT = "rsm:CrossIndustryInvoice";
const CONTEXT = `${ROOT}/rsm:ExchangedDocumentContext`;
const DOCUMENT = `${ROOT}/rsm:ExchangedDocument`;
const TRANSACTION = `${ROOT}/rsm:SupplyChainTradeTransaction`;
const LINE = `${TRANSACTION}/ram:IncludedSupplyChainTradeLineItem[{i}]`;
const AGREEMENT = `${TRANSACTION}/ram:ApplicableHeaderTradeAgreement`;
const SELLER = `${AGREEMENT}/ram:SellerTradeParty`;
const BUYER = `${AGREEMENT}/ram:BuyerTradeParty`;
const DELIVERY = `${TRANSACTION}/ram:ApplicableHeaderTradeDelivery`;
const SETTLEMENT = `${TRANSACTION}/ram:ApplicableHeaderTradeSettlement`;
const MEANS = `${SETTLEMENT}/ram:SpecifiedTradeSettlementPaymentMeans`;
const TRADE_TAX = `${SETTLEMENT}/ram:ApplicableTradeTax[{i}]`;
const TOTAL = `${SETTLEMENT}/ram:SpecifiedTradeSettlementHeaderMonetarySummation`;
const TERMS = `${SETTLEMENT}/ram:SpecifiedTradePaymentTerms`;
const PRECEDING = `${SETTLEMENT}/ram:InvoiceReferencedDocument`;

function partyRows(prefix: "seller" | "buyer", base: string, bt: Record<string, string>) {
  const role = prefix === "seller" ? "Seller" : "Buyer";
  return [
    { field: `${prefix}.name`, path: `${base}/ram:Name`, bt: bt.name, label: `${role} name` },
    {
      field: `${prefix}.legalRegId`,
      path: `${base}/ram:SpecifiedLegalOrganization/ram:ID`,
      bt: bt.legalRegId,
      label: `${role} legal registration identifier`,
    },
    {
      field: `${prefix}.legalRegScheme`,
      path: `${base}/ram:SpecifiedLegalOrganization/ram:ID/@schemeID`,
      bt: bt.legalRegScheme,
      label: `${role} legal registration scheme (ISO 6523 ICD)`,
    },
    {
      field: `${prefix}.tradeName`,
      path: `${base}/ram:SpecifiedLegalOrganization/ram:TradingBusinessName`,
      bt: bt.tradeName,
      label: `${role} trading name`,
    },
    {
      field: `${prefix}.contact.name`,
      path: `${base}/ram:DefinedTradeContact/ram:PersonName`,
      bt: bt.contactName,
      label: `${role} contact point`,
    },
    {
      field: `${prefix}.contact.phone`,
      path: `${base}/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber`,
      bt: bt.contactPhone,
      label: `${role} contact telephone number`,
    },
    {
      field: `${prefix}.contact.email`,
      path: `${base}/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID`,
      bt: bt.contactEmail,
      label: `${role} contact email address`,
    },
    {
      field: `${prefix}.address.postCode`,
      path: `${base}/ram:PostalTradeAddress/ram:PostcodeCode`,
      bt: bt.postCode,
      label: `${role} post code`,
    },
    {
      field: `${prefix}.address.street`,
      path: `${base}/ram:PostalTradeAddress/ram:LineOne`,
      bt: bt.street,
      label: `${role} address line 1`,
    },
    {
      field: `${prefix}.address.number`,
      path: `${base}/ram:PostalTradeAddress/ram:LineTwo`,
      bt: bt.number,
      label: `${role} address line 2`,
    },
    {
      field: `${prefix}.address.city`,
      path: `${base}/ram:PostalTradeAddress/ram:CityName`,
      bt: bt.city,
      label: `${role} city`,
    },
    {
      field: `${prefix}.address.country`,
      path: `${base}/ram:PostalTradeAddress/ram:CountryID`,
      bt: bt.country,
      label: `${role} country code (ISO 3166-1 alpha-2)`,
    },
    {
      field: `${prefix}.address.region`,
      path: `${base}/ram:PostalTradeAddress/ram:CountrySubDivisionName`,
      bt: bt.region,
      label: `${role} country subdivision`,
    },
    {
      field: `${prefix}.electronicAddress.id`,
      path: `${base}/ram:URIUniversalCommunication/ram:URIID`,
      bt: bt.electronicAddress,
      label: `${role} electronic address`,
    },
    {
      field: `${prefix}.electronicAddress.scheme`,
      path: `${base}/ram:URIUniversalCommunication/ram:URIID/@schemeID`,
      bt: bt.electronicAddressScheme,
      label: `${role} electronic address scheme (EAS)`,
    },
    {
      field: `${prefix}.vatId`,
      path: `${base}/ram:SpecifiedTaxRegistration[ram:ID/@schemeID='${CII_VAT_SCHEME_ID}']/ram:ID`,
      bt: bt.vatId,
      label: `${role} VAT identifier`,
    },
  ];
}

export const CII_MAP: MappingRow[] = [
  {
    field: "",
    path: `${CONTEXT}/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID`,
    bt: "BT-24",
    label: "Specification identifier (EN 16931 CII / Factur-X EN16931)",
  },
  { field: "number", path: `${DOCUMENT}/ram:ID`, bt: "BT-1", label: "Invoice number" },
  {
    field: "typeCode",
    path: `${DOCUMENT}/ram:TypeCode`,
    bt: "BT-3",
    label: "Invoice type code (UNCL1001)",
  },
  {
    field: "issueDate",
    path: `${DOCUMENT}/ram:IssueDateTime/udt:DateTimeString`,
    bt: "BT-2",
    label: "Invoice issue date (format 102, YYYYMMDD)",
  },
  {
    field: "note",
    path: `${DOCUMENT}/ram:IncludedNote/ram:Content`,
    bt: "BT-22",
    label: "Invoice note",
  },

  {
    field: "references.buyerReference",
    path: `${AGREEMENT}/ram:BuyerReference`,
    bt: "BT-10",
    label: "Buyer reference",
  },

  ...partyRows("seller", SELLER, {
    name: "BT-27",
    legalRegId: "BT-30",
    legalRegScheme: "BT-30-1",
    tradeName: "BT-28",
    contactName: "BT-41",
    contactPhone: "BT-42",
    contactEmail: "BT-43",
    postCode: "BT-38",
    street: "BT-35",
    number: "BT-36",
    city: "BT-37",
    country: "BT-40",
    region: "BT-39",
    electronicAddress: "BT-34",
    electronicAddressScheme: "BT-34-1",
    vatId: "BT-31",
  }),
  {
    field: "seller.taxId",
    path: `${SELLER}/ram:SpecifiedTaxRegistration[ram:ID/@schemeID='${CII_TAX_SCHEME_ID}']/ram:ID`,
    bt: "BT-32",
    label: "Seller tax registration identifier",
  },

  ...partyRows("buyer", BUYER, {
    name: "BT-44",
    legalRegId: "BT-47",
    legalRegScheme: "BT-47-1",
    tradeName: "BT-45",
    contactName: "BT-56",
    contactPhone: "BT-57",
    contactEmail: "BT-58",
    postCode: "BT-53",
    street: "BT-50",
    number: "BT-51",
    city: "BT-52",
    country: "BT-55",
    region: "BT-54",
    electronicAddress: "BT-49",
    electronicAddressScheme: "BT-49-1",
    vatId: "BT-48",
  }),

  {
    field: "references.salesOrder",
    path: `${AGREEMENT}/ram:SellerOrderReferencedDocument/ram:IssuerAssignedID`,
    bt: "BT-14",
    label: "Sales order reference",
  },
  {
    field: "references.purchaseOrder",
    path: `${AGREEMENT}/ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID`,
    bt: "BT-13",
    label: "Purchase order reference",
  },
  {
    field: "references.contract",
    path: `${AGREEMENT}/ram:ContractReferencedDocument/ram:IssuerAssignedID`,
    bt: "BT-12",
    label: "Contract reference",
  },
  {
    field: "references.tenderOrLot",
    path: `${AGREEMENT}/ram:AdditionalReferencedDocument[ram:TypeCode='${CII_TENDER_TYPE_CODE}']/ram:IssuerAssignedID`,
    bt: "BT-17",
    label: "Tender or lot reference",
  },
  {
    field: "",
    path: `${AGREEMENT}/ram:AdditionalReferencedDocument[ram:TypeCode='${CII_TENDER_TYPE_CODE}']/ram:TypeCode`,
    bt: "BT-17",
    label: "Tender or lot document type code (UNCL1001 50, EN 16931 CII binding)",
  },
  {
    field: "references.invoicedObject",
    path: `${AGREEMENT}/ram:AdditionalReferencedDocument[ram:TypeCode='${CII_INVOICED_OBJECT_TYPE_CODE}']/ram:IssuerAssignedID`,
    bt: "BT-18",
    label: "Invoiced object identifier",
  },
  {
    field: "",
    path: `${AGREEMENT}/ram:AdditionalReferencedDocument[ram:TypeCode='${CII_INVOICED_OBJECT_TYPE_CODE}']/ram:TypeCode`,
    bt: "BT-18",
    label: "Invoiced object document type code (UNCL1001 130, EN 16931 CII binding)",
  },
  {
    field: "references.project",
    path: `${AGREEMENT}/ram:SpecifiedProcuringProject/ram:ID`,
    bt: "BT-11",
    label: "Project reference",
  },
  {
    field: "",
    path: `${AGREEMENT}/ram:SpecifiedProcuringProject/ram:Name`,
    bt: "BT-11",
    label: "Project name - required by ram:SpecifiedProcuringProject (CII D16B), echoes BT-11",
  },
  {
    field: "references.despatchAdvice.number",
    path: `${DELIVERY}/ram:DespatchAdviceReferencedDocument/ram:IssuerAssignedID`,
    bt: "BT-16",
    label: "Despatch advice reference",
  },

  {
    field: "payment.remittanceInformation",
    path: `${SETTLEMENT}/ram:PaymentReference`,
    bt: "BT-83",
    label: "Remittance information",
  },
  {
    field: "currency",
    path: `${SETTLEMENT}/ram:InvoiceCurrencyCode`,
    bt: "BT-5",
    label: "Invoice currency code (ISO 4217)",
  },
  {
    field: "payment.meansCode",
    path: `${MEANS}/ram:TypeCode`,
    bt: "BT-81",
    label: "Payment means type code (UNCL4461)",
  },
  {
    field: "payment.meansText",
    path: `${MEANS}/ram:Information`,
    bt: "BT-82",
    label: "Payment means text",
  },
  {
    field: "payment.iban",
    path: `${MEANS}/ram:PayeePartyCreditorFinancialAccount/ram:IBANID`,
    bt: "BT-84",
    label: "Payment account identifier (IBAN)",
  },
  {
    field: "payment.accountName",
    path: `${MEANS}/ram:PayeePartyCreditorFinancialAccount/ram:AccountName`,
    bt: "BT-85",
    label: "Payment account name",
  },
  {
    field: "payment.bic",
    path: `${MEANS}/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID`,
    bt: "BT-86",
    label: "Payment service provider identifier (BIC)",
  },

  {
    field: "vatBreakdown.{i}.taxAmount",
    path: `${TRADE_TAX}/ram:CalculatedAmount`,
    bt: "BT-117",
    label: "VAT category tax amount",
  },
  {
    field: "vatBreakdown.{i}.reason",
    path: `${TRADE_TAX}/ram:ExemptionReason`,
    bt: "BT-120",
    label: "VAT exemption reason text",
  },
  {
    field: "vatBreakdown.{i}.taxableAmount",
    path: `${TRADE_TAX}/ram:BasisAmount`,
    bt: "BT-116",
    label: "VAT category taxable amount",
  },
  {
    field: "vatBreakdown.{i}.category",
    path: `${TRADE_TAX}/ram:CategoryCode`,
    bt: "BT-118",
    label: "VAT category code (UNCL5305)",
  },
  {
    field: "vatBreakdown.{i}.vatexCode",
    path: `${TRADE_TAX}/ram:ExemptionReasonCode`,
    bt: "BT-121",
    label: "VAT exemption reason code (VATEX)",
  },
  {
    field: "vatBreakdown.{i}.rate",
    path: `${TRADE_TAX}/ram:RateApplicablePercent`,
    bt: "BT-119",
    label: "VAT category rate",
  },

  {
    field: "payment.terms",
    path: `${TERMS}/ram:Description`,
    bt: "BT-20",
    label: "Payment terms",
  },
  {
    field: "dueDate",
    path: `${TERMS}/ram:DueDateDateTime/udt:DateTimeString`,
    bt: "BT-9",
    label: "Payment due date (format 102, YYYYMMDD)",
  },

  {
    field: "totals.lineExtension",
    path: `${TOTAL}/ram:LineTotalAmount`,
    bt: "BT-106",
    label: "Sum of invoice line net amounts",
  },
  {
    field: "totals.charge",
    path: `${TOTAL}/ram:ChargeTotalAmount`,
    bt: "BT-108",
    label: "Sum of charges on document level",
  },
  {
    field: "totals.allowance",
    path: `${TOTAL}/ram:AllowanceTotalAmount`,
    bt: "BT-107",
    label: "Sum of allowances on document level",
  },
  {
    field: "totals.taxExclusive",
    path: `${TOTAL}/ram:TaxBasisTotalAmount`,
    bt: "BT-109",
    label: "Invoice total amount without VAT",
  },
  {
    field: "totals.taxAmount",
    path: `${TOTAL}/ram:TaxTotalAmount`,
    bt: "BT-110",
    label: "Invoice total VAT amount",
  },
  {
    field: "totals.rounding",
    path: `${TOTAL}/ram:RoundingAmount`,
    bt: "BT-114",
    label: "Rounding amount",
  },
  {
    field: "totals.taxInclusive",
    path: `${TOTAL}/ram:GrandTotalAmount`,
    bt: "BT-112",
    label: "Invoice total amount with VAT",
  },
  {
    field: "totals.prepaid",
    path: `${TOTAL}/ram:TotalPrepaidAmount`,
    bt: "BT-113",
    label: "Paid amount",
  },
  {
    field: "totals.payable",
    path: `${TOTAL}/ram:DuePayableAmount`,
    bt: "BT-115",
    label: "Amount due for payment",
  },

  {
    field: "references.precedingInvoice.number",
    path: `${PRECEDING}/ram:IssuerAssignedID`,
    bt: "BT-25",
    label: "Preceding invoice reference",
  },
  {
    field: "references.precedingInvoice.issueDate",
    path: `${PRECEDING}/ram:FormattedIssueDateTime/qdt:DateTimeString`,
    bt: "BT-26",
    label: "Preceding invoice issue date (format 102, YYYYMMDD)",
  },

  {
    field: "lines.{i}.id",
    path: `${LINE}/ram:AssociatedDocumentLineDocument/ram:LineID`,
    bt: "BT-126",
    label: "Invoice line identifier",
  },
  {
    field: "lines.{i}.name",
    path: `${LINE}/ram:SpecifiedTradeProduct/ram:Name`,
    bt: "BT-153",
    label: "Item name",
  },
  {
    field: "lines.{i}.description",
    path: `${LINE}/ram:SpecifiedTradeProduct/ram:Description`,
    bt: "BT-154",
    label: "Item description",
  },
  {
    field: "lines.{i}.unitPriceNet",
    path: `${LINE}/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount`,
    bt: "BT-146",
    label: "Item net price",
  },
  {
    field: "lines.{i}.quantity",
    path: `${LINE}/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity`,
    bt: "BT-129",
    label: "Invoiced quantity",
  },
  {
    field: "lines.{i}.unitCode",
    path: `${LINE}/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode`,
    bt: "BT-130",
    label: "Invoiced quantity unit of measure (UN/ECE Rec 20)",
  },
  {
    field: "lines.{i}.vat.category",
    path: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode`,
    bt: "BT-151",
    label: "Invoiced item VAT category code",
  },
  {
    field: "lines.{i}.vat.rate",
    path: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent`,
    bt: "BT-152",
    label: "Invoiced item VAT rate",
  },
  {
    field: "lines.{i}.netAmount",
    path: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount`,
    bt: "BT-131",
    label: "Invoice line net amount",
  },
];

export function ciiRow(field: string): MappingRow {
  const row = CII_MAP.find((candidate) => candidate.field === field);
  if (!row) throw new Error(`cii-map: no row for field "${field}"`);
  return row;
}

export function ciiConstantRow(bt: string): MappingRow {
  const row = CII_MAP.find((candidate) => candidate.field === "" && candidate.bt === bt);
  if (!row) throw new Error(`cii-map: no constant row for ${bt}`);
  return row;
}

export function ciiDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replace(/-/g, "") : iso;
}

export function isoDate(cii: string | undefined): string | undefined {
  if (!cii) return undefined;
  return /^\d{8}$/.test(cii) ? `${cii.slice(0, 4)}-${cii.slice(4, 6)}-${cii.slice(6, 8)}` : cii;
}
