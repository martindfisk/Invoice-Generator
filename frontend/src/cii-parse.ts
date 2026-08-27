import {
  CII_INVOICED_OBJECT_TYPE_CODE,
  CII_TAX_SCHEME_ID,
  CII_TENDER_TYPE_CODE,
  CII_VAT_SCHEME_ID,
  isoDate,
} from "./cii-map";
import type {
  Buyer,
  Channel,
  Contact,
  ElectronicAddress,
  Invoice,
  Line,
  Party,
  Payment,
  References,
  Totals,
  VatBreakdownRow,
  VatCategory,
} from "./model";

const VAT_CATEGORIES: VatCategory[] = ["S", "Z", "E", "AE", "K", "G", "O"];

function parseDocument(xml: string): Element {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const failure = document.getElementsByTagName("parsererror")[0];
  if (failure) throw new Error(`cii-parse: ${failure.textContent ?? "malformed XML"}`);
  const root = document.documentElement;
  if (!root || root.localName !== "CrossIndustryInvoice") {
    throw new Error(
      `cii-parse: expected a <CrossIndustryInvoice> root, got <${root?.localName ?? "?"}>`,
    );
  }
  return root;
}

function children(parent: Element | null, name: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.children).filter((element) => element.localName === name);
}

function child(parent: Element | null, ...path: string[]): Element | null {
  let current = parent;
  for (const name of path) {
    current = children(current, name)[0] ?? null;
    if (!current) return null;
  }
  return current;
}

function text(parent: Element | null, ...path: string[]): string | undefined {
  const value = child(parent, ...path)?.textContent?.trim();
  return value ? value : undefined;
}

function required(parent: Element | null, ...path: string[]): string {
  return text(parent, ...path) ?? "";
}

function attribute(element: Element | null, name: string): string | undefined {
  const value = element?.getAttribute(name)?.trim();
  return value ? value : undefined;
}

function dateOf(parent: Element | null, ...path: string[]): string | undefined {
  return isoDate(text(child(parent, ...path), "DateTimeString"));
}

function taxRegistration(party: Element | null, scheme: string): string | undefined {
  for (const registration of children(party, "SpecifiedTaxRegistration")) {
    const id = child(registration, "ID");
    if (attribute(id, "schemeID") !== scheme) continue;
    const value = id?.textContent?.trim();
    if (value) return value;
  }
  return undefined;
}

function endpoint(party: Element | null): ElectronicAddress | undefined {
  const element = child(party, "URIUniversalCommunication", "URIID");
  const id = element?.textContent?.trim();
  const scheme = attribute(element, "schemeID");
  if (!id || !scheme) return undefined;
  return { scheme, id };
}

function contact(party: Element | null): Contact | undefined {
  const element = child(party, "DefinedTradeContact");
  if (!element) return undefined;
  const value: Contact = {
    name: text(element, "PersonName"),
    phone: text(element, "TelephoneUniversalCommunication", "CompleteNumber"),
    email: text(element, "EmailURIUniversalCommunication", "URIID"),
  };
  return value.name || value.phone || value.email ? value : undefined;
}

function party(element: Element | null): Party {
  const address = child(element, "PostalTradeAddress");
  const organization = child(element, "SpecifiedLegalOrganization");
  return {
    name: required(element, "Name"),
    tradeName: text(organization, "TradingBusinessName"),
    vatId: taxRegistration(element, CII_VAT_SCHEME_ID),
    taxId: taxRegistration(element, CII_TAX_SCHEME_ID),
    legalRegId: text(organization, "ID"),
    legalRegScheme: attribute(child(organization, "ID"), "schemeID"),
    electronicAddress: endpoint(element),
    address: {
      street: required(address, "LineOne"),
      number: text(address, "LineTwo"),
      city: required(address, "CityName"),
      postCode: required(address, "PostcodeCode"),
      region: text(address, "CountrySubDivisionName"),
      country: required(address, "CountryID"),
    },
    contact: contact(element),
  };
}

function channelOf(buyer: Party): Channel {
  if (buyer.electronicAddress && /^[0-9]{4}$/.test(buyer.electronicAddress.scheme)) {
    return {
      kind: "PEPPOL",
      participantId: `${buyer.electronicAddress.scheme}:${buyer.electronicAddress.id}`,
    };
  }
  return { kind: "EMAIL", email: buyer.electronicAddress?.id ?? buyer.contact?.email ?? "" };
}

function category(value: string | undefined): VatCategory {
  const found = VAT_CATEGORIES.find((candidate) => candidate === value);
  if (!found) throw new Error(`cii-parse: unknown VAT category code "${value ?? ""}"`);
  return found;
}

function additionalReference(agreement: Element | null, typeCode: string): string | undefined {
  for (const reference of children(agreement, "AdditionalReferencedDocument")) {
    if (text(reference, "TypeCode") !== typeCode) continue;
    const value = text(reference, "IssuerAssignedID");
    if (value) return value;
  }
  return undefined;
}

function references(
  agreement: Element | null,
  delivery: Element | null,
  settlement: Element | null,
): References | undefined {
  const preceding = child(settlement, "InvoiceReferencedDocument");
  const despatch = text(delivery, "DespatchAdviceReferencedDocument", "IssuerAssignedID");
  const value: References = {
    buyerReference: text(agreement, "BuyerReference"),
    project: text(agreement, "SpecifiedProcuringProject", "ID"),
    contract: text(agreement, "ContractReferencedDocument", "IssuerAssignedID"),
    purchaseOrder: text(agreement, "BuyerOrderReferencedDocument", "IssuerAssignedID"),
    salesOrder: text(agreement, "SellerOrderReferencedDocument", "IssuerAssignedID"),
    despatchAdvice: despatch ? { number: despatch } : undefined,
    tenderOrLot: additionalReference(agreement, CII_TENDER_TYPE_CODE),
    invoicedObject: additionalReference(agreement, CII_INVOICED_OBJECT_TYPE_CODE),
    precedingInvoice: preceding
      ? {
          number: required(preceding, "IssuerAssignedID"),
          issueDate: dateOf(preceding, "FormattedIssueDateTime"),
        }
      : undefined,
  };
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

function payment(settlement: Element | null): Payment {
  const means = child(settlement, "SpecifiedTradeSettlementPaymentMeans");
  const account = child(means, "PayeePartyCreditorFinancialAccount");
  return {
    meansCode: required(means, "TypeCode"),
    meansText: text(means, "Information"),
    remittanceInformation: text(settlement, "PaymentReference"),
    iban: text(account, "IBANID"),
    accountName: text(account, "AccountName"),
    bic: text(means, "PayeeSpecifiedCreditorFinancialInstitution", "BICID"),
    terms: text(settlement, "SpecifiedTradePaymentTerms", "Description"),
  };
}

function totals(settlement: Element | null): Totals {
  const summation = child(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
  return {
    lineExtension: required(summation, "LineTotalAmount"),
    taxExclusive: required(summation, "TaxBasisTotalAmount"),
    taxAmount: required(summation, "TaxTotalAmount"),
    taxInclusive: required(summation, "GrandTotalAmount"),
    allowance: text(summation, "AllowanceTotalAmount"),
    charge: text(summation, "ChargeTotalAmount"),
    prepaid: text(summation, "TotalPrepaidAmount"),
    rounding: text(summation, "RoundingAmount"),
    payable: required(summation, "DuePayableAmount"),
  };
}

function breakdown(settlement: Element | null): VatBreakdownRow[] {
  return children(settlement, "ApplicableTradeTax").map((row) => ({
    category: category(text(row, "CategoryCode")),
    rate: required(row, "RateApplicablePercent"),
    taxableAmount: required(row, "BasisAmount"),
    taxAmount: required(row, "CalculatedAmount"),
    vatexCode: text(row, "ExemptionReasonCode"),
    reason: text(row, "ExemptionReason"),
  }));
}

function lines(transaction: Element): Line[] {
  return children(transaction, "IncludedSupplyChainTradeLineItem").map((line) => {
    const product = child(line, "SpecifiedTradeProduct");
    const settlement = child(line, "SpecifiedLineTradeSettlement");
    const tradeTax = child(settlement, "ApplicableTradeTax");
    const quantity = child(line, "SpecifiedLineTradeDelivery", "BilledQuantity");
    return {
      id: required(line, "AssociatedDocumentLineDocument", "LineID"),
      name: required(product, "Name"),
      description: text(product, "Description"),
      quantity: quantity?.textContent?.trim() ?? "",
      unitCode: attribute(quantity, "unitCode") ?? "",
      unitPriceNet: required(
        child(line, "SpecifiedLineTradeAgreement", "NetPriceProductTradePrice"),
        "ChargeAmount",
      ),
      netAmount: required(
        child(settlement, "SpecifiedTradeSettlementLineMonetarySummation"),
        "LineTotalAmount",
      ),
      vat: {
        category: category(text(tradeTax, "CategoryCode")),
        rate: required(tradeTax, "RateApplicablePercent"),
      },
    };
  });
}

export function parseCii(xml: string): Invoice {
  const root = parseDocument(xml);
  const document = child(root, "ExchangedDocument");
  const transaction = child(root, "SupplyChainTradeTransaction");
  if (!transaction) throw new Error("cii-parse: no <rsm:SupplyChainTradeTransaction>");
  const agreement = child(transaction, "ApplicableHeaderTradeAgreement");
  const delivery = child(transaction, "ApplicableHeaderTradeDelivery");
  const settlement = child(transaction, "ApplicableHeaderTradeSettlement");
  const parsedBuyer = party(child(agreement, "BuyerTradeParty"));
  const buyer: Buyer = { ...parsedBuyer, channel: channelOf(parsedBuyer) };
  const typeCode = required(document, "TypeCode");
  return {
    format: "cii",
    number: required(document, "ID"),
    issueDate: dateOf(document, "IssueDateTime") ?? "",
    dueDate: dateOf(child(settlement, "SpecifiedTradePaymentTerms"), "DueDateDateTime"),
    typeCode: typeCode === "381" ? "381" : "380",
    currency: required(settlement, "InvoiceCurrencyCode"),
    note: text(document, "IncludedNote", "Content"),
    references: references(agreement, delivery, settlement),
    seller: party(child(agreement, "SellerTradeParty")),
    buyer,
    lines: lines(transaction),
    vatBreakdown: breakdown(settlement),
    payment: payment(settlement),
    totals: totals(settlement),
  };
}
