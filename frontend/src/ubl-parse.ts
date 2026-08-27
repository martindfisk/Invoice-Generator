import { UBL_INVOICED_OBJECT_TYPE_CODE } from "./ubl-map";
import type {
  Buyer,
  Channel,
  Contact,
  Delivery,
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
  if (failure) throw new Error(`ubl-parse: ${failure.textContent ?? "malformed XML"}`);
  const root = document.documentElement;
  if (!root || root.localName !== "Invoice") {
    throw new Error(`ubl-parse: expected an <Invoice> root, got <${root?.localName ?? "?"}>`);
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
  const element = child(parent, ...path);
  const value = element?.textContent?.trim();
  return value ? value : undefined;
}

function required(parent: Element | null, ...path: string[]): string {
  return text(parent, ...path) ?? "";
}

function attribute(element: Element | null, name: string): string | undefined {
  const value = element?.getAttribute(name)?.trim();
  return value ? value : undefined;
}

function endpoint(party: Element | null): ElectronicAddress | undefined {
  const element = child(party, "EndpointID");
  const id = element?.textContent?.trim();
  const scheme = attribute(element, "schemeID");
  if (!id || !scheme) return undefined;
  return { scheme, id };
}

function contact(party: Element | null): Contact | undefined {
  const element = child(party, "Contact");
  if (!element) return undefined;
  const value: Contact = {
    name: text(element, "Name"),
    phone: text(element, "Telephone"),
    email: text(element, "ElectronicMail"),
  };
  return value.name || value.phone || value.email ? value : undefined;
}

function party(element: Element | null): Party {
  const address = child(element, "PostalAddress");
  const legalEntity = child(element, "PartyLegalEntity");
  return {
    name: required(legalEntity, "RegistrationName"),
    tradeName: text(element, "PartyName", "Name"),
    vatId: text(element, "PartyTaxScheme", "CompanyID"),
    legalRegId: text(legalEntity, "CompanyID"),
    legalRegScheme: attribute(child(legalEntity, "CompanyID"), "schemeID"),
    electronicAddress: endpoint(element),
    address: {
      street: required(address, "StreetName"),
      number: text(address, "AdditionalStreetName"),
      city: required(address, "CityName"),
      postCode: required(address, "PostalZone"),
      region: text(address, "CountrySubentity"),
      country: required(address, "Country", "IdentificationCode"),
    },
    contact: contact(element),
  };
}

function channelOf(buyer: Party): Channel {
  if (buyer.electronicAddress) {
    return {
      kind: "PEPPOL",
      participantId: `${buyer.electronicAddress.scheme}:${buyer.electronicAddress.id}`,
    };
  }
  return { kind: "EMAIL", email: buyer.contact?.email ?? "" };
}

function category(value: string | undefined): VatCategory {
  const found = VAT_CATEGORIES.find((candidate) => candidate === value);
  if (!found) throw new Error(`ubl-parse: unknown VAT category code "${value ?? ""}"`);
  return found;
}

function invoicedObject(root: Element): string | undefined {
  for (const reference of children(root, "AdditionalDocumentReference")) {
    if (text(reference, "DocumentTypeCode") !== UBL_INVOICED_OBJECT_TYPE_CODE) continue;
    const value = text(reference, "ID");
    if (value) return value;
  }
  return undefined;
}

function references(root: Element): References | undefined {
  const preceding = child(root, "BillingReference", "InvoiceDocumentReference");
  const despatch = text(root, "DespatchDocumentReference", "ID");
  const value: References = {
    buyerReference: text(root, "BuyerReference"),
    project: text(root, "ProjectReference", "ID"),
    contract: text(root, "ContractDocumentReference", "ID"),
    purchaseOrder: text(root, "OrderReference", "ID"),
    salesOrder: text(root, "OrderReference", "SalesOrderID"),
    despatchAdvice: despatch ? { number: despatch } : undefined,
    tenderOrLot: text(root, "OriginatorDocumentReference", "ID"),
    invoicedObject: invoicedObject(root),
    precedingInvoice: preceding
      ? { number: required(preceding, "ID"), issueDate: text(preceding, "IssueDate") }
      : undefined,
  };
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

function delivery(root: Element): Delivery | undefined {
  const date = text(root, "Delivery", "ActualDeliveryDate");
  return date ? { date } : undefined;
}

function payment(root: Element): Payment {
  const means = child(root, "PaymentMeans");
  const account = child(means, "PayeeFinancialAccount");
  return {
    meansCode: required(means, "PaymentMeansCode"),
    meansText: attribute(child(means, "PaymentMeansCode"), "name"),
    remittanceInformation: text(means, "PaymentID"),
    iban: text(account, "ID"),
    accountName: text(account, "Name"),
    bic: text(account, "FinancialInstitutionBranch", "ID"),
    terms: text(root, "PaymentTerms", "Note"),
  };
}

function totals(root: Element): Totals {
  const monetary = child(root, "LegalMonetaryTotal");
  return {
    lineExtension: required(monetary, "LineExtensionAmount"),
    taxExclusive: required(monetary, "TaxExclusiveAmount"),
    taxAmount: required(child(root, "TaxTotal"), "TaxAmount"),
    taxInclusive: required(monetary, "TaxInclusiveAmount"),
    allowance: text(monetary, "AllowanceTotalAmount"),
    charge: text(monetary, "ChargeTotalAmount"),
    prepaid: text(monetary, "PrepaidAmount"),
    rounding: text(monetary, "PayableRoundingAmount"),
    payable: required(monetary, "PayableAmount"),
  };
}

function breakdown(root: Element): VatBreakdownRow[] {
  return children(child(root, "TaxTotal"), "TaxSubtotal").map((subtotal) => {
    const taxCategory = child(subtotal, "TaxCategory");
    return {
      category: category(text(taxCategory, "ID")),
      rate: required(taxCategory, "Percent"),
      taxableAmount: required(subtotal, "TaxableAmount"),
      taxAmount: required(subtotal, "TaxAmount"),
      vatexCode: text(taxCategory, "TaxExemptionReasonCode"),
      reason: text(taxCategory, "TaxExemptionReason"),
    };
  });
}

function lines(root: Element): Line[] {
  return children(root, "InvoiceLine").map((line) => {
    const item = child(line, "Item");
    const taxCategory = child(item, "ClassifiedTaxCategory");
    return {
      id: required(line, "ID"),
      name: required(item, "Name"),
      description: text(item, "Description"),
      quantity: required(line, "InvoicedQuantity"),
      unitCode: attribute(child(line, "InvoicedQuantity"), "unitCode") ?? "",
      unitPriceNet: required(child(line, "Price"), "PriceAmount"),
      netAmount: required(line, "LineExtensionAmount"),
      vat: {
        category: category(text(taxCategory, "ID")),
        rate: required(taxCategory, "Percent"),
      },
    };
  });
}

export function parseUbl(xml: string): Invoice {
  const root = parseDocument(xml);
  const seller = party(child(root, "AccountingSupplierParty", "Party"));
  const parsedBuyer = party(child(root, "AccountingCustomerParty", "Party"));
  const buyer: Buyer = { ...parsedBuyer, channel: channelOf(parsedBuyer) };
  const typeCode = required(root, "InvoiceTypeCode");
  return {
    format: "ubl",
    number: required(root, "ID"),
    issueDate: required(root, "IssueDate"),
    dueDate: text(root, "DueDate"),
    typeCode: typeCode === "381" ? "381" : "380",
    currency: required(root, "DocumentCurrencyCode"),
    note: text(root, "Note"),
    references: references(root),
    seller,
    buyer,
    delivery: delivery(root),
    lines: lines(root),
    vatBreakdown: breakdown(root),
    payment: payment(root),
    totals: totals(root),
  };
}
