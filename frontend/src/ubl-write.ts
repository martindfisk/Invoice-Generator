import { format } from "./decimal";
import type { Buyer, Invoice, Party } from "./model";
import {
  UBL_CUSTOMIZATION_ID,
  UBL_INVOICED_OBJECT_TYPE_CODE,
  UBL_NAMESPACES,
  UBL_PROFILE_ID,
  UBL_TAX_SCHEME,
  ublConstantRow,
  ublRow,
} from "./ubl-map";
import { attr, el, group, node, serialize, type XmlNode } from "./xml-writer";

const AMOUNT_DP = 2;
const RATE_DP = 2;

function amount(value: string | undefined) {
  return value === undefined ? undefined : format(value, AMOUNT_DP);
}

function taxScheme(): XmlNode {
  return node("cac:TaxScheme", [{ name: "cbc:ID", text: UBL_TAX_SCHEME }]);
}

function postalAddress(prefix: "seller" | "buyer", party: Party): XmlNode {
  return node("cac:PostalAddress", [
    el(ublRow(`${prefix}.address.street`), party.address.street),
    el(ublRow(`${prefix}.address.number`), party.address.number),
    el(ublRow(`${prefix}.address.city`), party.address.city),
    el(ublRow(`${prefix}.address.postCode`), party.address.postCode),
    el(ublRow(`${prefix}.address.region`), party.address.region),
    group("cac:Country", [el(ublRow(`${prefix}.address.country`), party.address.country)]),
  ]);
}

function partyNode(prefix: "seller" | "buyer", party: Party): XmlNode {
  return node("cac:Party", [
    el(ublRow(`${prefix}.electronicAddress.id`), party.electronicAddress?.id, {
      ...attr(ublRow(`${prefix}.electronicAddress.scheme`), party.electronicAddress?.scheme),
    }),
    group("cac:PartyName", [el(ublRow(`${prefix}.tradeName`), party.tradeName)]),
    postalAddress(prefix, party),
    group("cac:PartyTaxScheme", [
      el(ublRow(`${prefix}.vatId`), party.vatId),
      party.vatId ? taxScheme() : null,
    ]),
    group("cac:PartyLegalEntity", [
      el(ublRow(`${prefix}.name`), party.name),
      el(ublRow(`${prefix}.legalRegId`), party.legalRegId, {
        ...attr(ublRow(`${prefix}.legalRegScheme`), party.legalRegScheme),
      }),
    ]),
    group("cac:Contact", [
      el(ublRow(`${prefix}.contact.name`), party.contact?.name),
      el(ublRow(`${prefix}.contact.phone`), party.contact?.phone),
      el(ublRow(`${prefix}.contact.email`), party.contact?.email),
    ]),
  ]);
}

function paymentMeans(invoice: Invoice): XmlNode | null {
  const { payment } = invoice;
  return group("cac:PaymentMeans", [
    el(ublRow("payment.meansCode"), payment.meansCode, {
      ...attr(ublRow("payment.meansText"), payment.meansText),
    }),
    el(ublRow("payment.remittanceInformation"), payment.remittanceInformation),
    group("cac:PayeeFinancialAccount", [
      el(ublRow("payment.iban"), payment.iban),
      el(ublRow("payment.accountName"), payment.accountName),
      group("cac:FinancialInstitutionBranch", [el(ublRow("payment.bic"), payment.bic)]),
    ]),
  ]);
}

function taxTotal(invoice: Invoice): XmlNode {
  const currency = invoice.currency;
  const subtotals = invoice.vatBreakdown.map((row) =>
    node("cac:TaxSubtotal", [
      el(ublRow("vatBreakdown.{i}.taxableAmount"), amount(row.taxableAmount), {
        currencyID: currency,
      }),
      el(ublRow("vatBreakdown.{i}.taxAmount"), amount(row.taxAmount), {
        currencyID: currency,
      }),
      node("cac:TaxCategory", [
        el(ublRow("vatBreakdown.{i}.category"), row.category),
        el(ublRow("vatBreakdown.{i}.rate"), format(row.rate, RATE_DP)),
        el(ublRow("vatBreakdown.{i}.vatexCode"), row.vatexCode),
        el(ublRow("vatBreakdown.{i}.reason"), row.reason),
        taxScheme(),
      ]),
    ]),
  );
  return node("cac:TaxTotal", [
    el(ublRow("totals.taxAmount"), amount(invoice.totals.taxAmount), {
      currencyID: currency,
    }),
    ...subtotals,
  ]);
}

function legalMonetaryTotal(invoice: Invoice): XmlNode {
  const currency = invoice.currency;
  const totals = invoice.totals;
  const money = (field: string, value: string | undefined) =>
    el(ublRow(field), amount(value), { currencyID: currency });
  return node("cac:LegalMonetaryTotal", [
    money("totals.lineExtension", totals.lineExtension),
    money("totals.taxExclusive", totals.taxExclusive),
    money("totals.taxInclusive", totals.taxInclusive),
    money("totals.allowance", totals.allowance),
    money("totals.charge", totals.charge),
    money("totals.prepaid", totals.prepaid),
    money("totals.rounding", totals.rounding),
    money("totals.payable", totals.payable),
  ]);
}

function invoiceLines(invoice: Invoice): XmlNode[] {
  const currency = invoice.currency;
  return invoice.lines.map((line) =>
    node("cac:InvoiceLine", [
      el(ublRow("lines.{i}.id"), line.id),
      el(ublRow("lines.{i}.quantity"), format(line.quantity, AMOUNT_DP), {
        ...attr(ublRow("lines.{i}.unitCode"), line.unitCode),
      }),
      el(ublRow("lines.{i}.netAmount"), amount(line.netAmount), {
        currencyID: currency,
      }),
      node("cac:Item", [
        el(ublRow("lines.{i}.description"), line.description),
        el(ublRow("lines.{i}.name"), line.name),
        node("cac:ClassifiedTaxCategory", [
          el(ublRow("lines.{i}.vat.category"), line.vat.category),
          el(ublRow("lines.{i}.vat.rate"), format(line.vat.rate, RATE_DP)),
          taxScheme(),
        ]),
      ]),
      node("cac:Price", [
        el(ublRow("lines.{i}.unitPriceNet"), amount(line.unitPriceNet), {
          currencyID: currency,
        }),
      ]),
    ]),
  );
}

export function writeUbl(invoice: Invoice, customizationId = UBL_CUSTOMIZATION_ID): string {
  const references = invoice.references ?? {};
  const buyer: Buyer = invoice.buyer;
  const root = node(
    "Invoice",
    [
      el(ublConstantRow("BT-24"), customizationId),
      el(ublConstantRow("BT-23"), UBL_PROFILE_ID),
      el(ublRow("number"), invoice.number),
      el(ublRow("issueDate"), invoice.issueDate),
      el(ublRow("dueDate"), invoice.dueDate),
      el(ublRow("typeCode"), invoice.typeCode),
      el(ublRow("note"), invoice.note),
      el(ublRow("currency"), invoice.currency),
      el(ublRow("references.buyerReference"), references.buyerReference),
      group("cac:OrderReference", [
        el(ublRow("references.purchaseOrder"), references.purchaseOrder),
        el(ublRow("references.salesOrder"), references.salesOrder),
      ]),
      group("cac:BillingReference", [
        group("cac:InvoiceDocumentReference", [
          el(ublRow("references.precedingInvoice.number"), references.precedingInvoice?.number),
          el(
            ublRow("references.precedingInvoice.issueDate"),
            references.precedingInvoice?.issueDate,
          ),
        ]),
      ]),
      group("cac:DespatchDocumentReference", [
        el(ublRow("references.despatchAdvice.number"), references.despatchAdvice?.number),
      ]),
      group("cac:OriginatorDocumentReference", [
        el(ublRow("references.tenderOrLot"), references.tenderOrLot),
      ]),
      group("cac:ContractDocumentReference", [
        el(ublRow("references.contract"), references.contract),
      ]),
      group("cac:AdditionalDocumentReference", [
        el(ublRow("references.invoicedObject"), references.invoicedObject),
        references.invoicedObject
          ? el(ublConstantRow("BT-18"), UBL_INVOICED_OBJECT_TYPE_CODE)
          : null,
      ]),
      group("cac:ProjectReference", [el(ublRow("references.project"), references.project)]),
      node("cac:AccountingSupplierParty", [partyNode("seller", invoice.seller)]),
      node("cac:AccountingCustomerParty", [partyNode("buyer", buyer)]),
      group("cac:Delivery", [el(ublRow("delivery.date"), invoice.delivery?.date)]),
      paymentMeans(invoice),
      group("cac:PaymentTerms", [el(ublRow("payment.terms"), invoice.payment.terms)]),
      taxTotal(invoice),
      legalMonetaryTotal(invoice),
      ...invoiceLines(invoice),
    ],
    UBL_NAMESPACES,
  );
  return serialize(root);
}
