import {
  CII_DATE_FORMAT,
  CII_GUIDELINE_ID,
  CII_INVOICED_OBJECT_TYPE_CODE,
  CII_NAMESPACES,
  CII_TAX_SCHEME_ID,
  CII_TAX_TYPE_CODE,
  CII_TENDER_TYPE_CODE,
  CII_VAT_SCHEME_ID,
  ciiConstantRow,
  ciiDate,
  ciiRow,
} from "./cii-map";
import { format } from "./decimal";
import type { Invoice, Party } from "./model";
import { attr, el, group, node, serialize, type XmlNode } from "./xml-writer";

const AMOUNT_DP = 2;
const RATE_DP = 2;

function amount(value: string | undefined) {
  return value === undefined ? undefined : format(value, AMOUNT_DP);
}

function dateNode(name: string, row: string, iso: string | undefined) {
  const child = el(ciiRow(row), ciiDate(iso), { format: CII_DATE_FORMAT });
  return child ? node(name, [child]) : null;
}

function taxRegistration(row: string, schemeId: string, value: string | undefined): XmlNode | null {
  const child = el(ciiRow(row), value, { schemeID: schemeId });
  return child ? node("ram:SpecifiedTaxRegistration", [child]) : null;
}

function partyNode(name: string, prefix: "seller" | "buyer", party: Party): XmlNode {
  return node(name, [
    el(ciiRow(`${prefix}.name`), party.name),
    group("ram:SpecifiedLegalOrganization", [
      el(ciiRow(`${prefix}.legalRegId`), party.legalRegId, {
        ...attr(ciiRow(`${prefix}.legalRegScheme`), party.legalRegScheme),
      }),
      el(ciiRow(`${prefix}.tradeName`), party.tradeName),
    ]),
    group("ram:DefinedTradeContact", [
      el(ciiRow(`${prefix}.contact.name`), party.contact?.name),
      group("ram:TelephoneUniversalCommunication", [
        el(ciiRow(`${prefix}.contact.phone`), party.contact?.phone),
      ]),
      group("ram:EmailURIUniversalCommunication", [
        el(ciiRow(`${prefix}.contact.email`), party.contact?.email),
      ]),
    ]),
    node("ram:PostalTradeAddress", [
      el(ciiRow(`${prefix}.address.postCode`), party.address.postCode),
      el(ciiRow(`${prefix}.address.street`), party.address.street),
      el(ciiRow(`${prefix}.address.number`), party.address.number),
      el(ciiRow(`${prefix}.address.city`), party.address.city),
      el(ciiRow(`${prefix}.address.country`), party.address.country),
      el(ciiRow(`${prefix}.address.region`), party.address.region),
    ]),
    group("ram:URIUniversalCommunication", [
      el(ciiRow(`${prefix}.electronicAddress.id`), party.electronicAddress?.id, {
        ...attr(ciiRow(`${prefix}.electronicAddress.scheme`), party.electronicAddress?.scheme),
      }),
    ]),
    taxRegistration(`${prefix}.vatId`, CII_VAT_SCHEME_ID, party.vatId),
    prefix === "seller" ? taxRegistration("seller.taxId", CII_TAX_SCHEME_ID, party.taxId) : null,
  ]);
}

function tradeLines(invoice: Invoice): XmlNode[] {
  return invoice.lines.map((line) =>
    node("ram:IncludedSupplyChainTradeLineItem", [
      node("ram:AssociatedDocumentLineDocument", [el(ciiRow("lines.{i}.id"), line.id)]),
      node("ram:SpecifiedTradeProduct", [
        el(ciiRow("lines.{i}.name"), line.name),
        el(ciiRow("lines.{i}.description"), line.description),
      ]),
      node("ram:SpecifiedLineTradeAgreement", [
        node("ram:NetPriceProductTradePrice", [
          el(ciiRow("lines.{i}.unitPriceNet"), amount(line.unitPriceNet)),
        ]),
      ]),
      node("ram:SpecifiedLineTradeDelivery", [
        el(ciiRow("lines.{i}.quantity"), format(line.quantity, AMOUNT_DP), {
          ...attr(ciiRow("lines.{i}.unitCode"), line.unitCode),
        }),
      ]),
      node("ram:SpecifiedLineTradeSettlement", [
        node("ram:ApplicableTradeTax", [
          { name: "ram:TypeCode", text: CII_TAX_TYPE_CODE },
          el(ciiRow("lines.{i}.vat.category"), line.vat.category),
          el(ciiRow("lines.{i}.vat.rate"), format(line.vat.rate, RATE_DP)),
        ]),
        node("ram:SpecifiedTradeSettlementLineMonetarySummation", [
          el(ciiRow("lines.{i}.netAmount"), amount(line.netAmount)),
        ]),
      ]),
    ]),
  );
}

function additionalReference(
  field: string,
  typeCode: string,
  bt: string,
  value: string | undefined,
): XmlNode | null {
  return group("ram:AdditionalReferencedDocument", [
    el(ciiRow(field), value),
    value ? el(ciiConstantRow(bt), typeCode) : null,
  ]);
}

function headerTradeAgreement(invoice: Invoice): XmlNode {
  const references = invoice.references ?? {};
  return node("ram:ApplicableHeaderTradeAgreement", [
    el(ciiRow("references.buyerReference"), references.buyerReference),
    partyNode("ram:SellerTradeParty", "seller", invoice.seller),
    partyNode("ram:BuyerTradeParty", "buyer", invoice.buyer),
    group("ram:SellerOrderReferencedDocument", [
      el(ciiRow("references.salesOrder"), references.salesOrder),
    ]),
    group("ram:BuyerOrderReferencedDocument", [
      el(ciiRow("references.purchaseOrder"), references.purchaseOrder),
    ]),
    group("ram:ContractReferencedDocument", [
      el(ciiRow("references.contract"), references.contract),
    ]),
    additionalReference(
      "references.tenderOrLot",
      CII_TENDER_TYPE_CODE,
      "BT-17",
      references.tenderOrLot,
    ),
    additionalReference(
      "references.invoicedObject",
      CII_INVOICED_OBJECT_TYPE_CODE,
      "BT-18",
      references.invoicedObject,
    ),
    group("ram:SpecifiedProcuringProject", [
      el(ciiRow("references.project"), references.project),
      el(ciiConstantRow("BT-11"), references.project),
    ]),
  ]);
}

function headerTradeDelivery(invoice: Invoice): XmlNode {
  return node("ram:ApplicableHeaderTradeDelivery", [
    group("ram:DespatchAdviceReferencedDocument", [
      el(ciiRow("references.despatchAdvice.number"), invoice.references?.despatchAdvice?.number),
    ]),
  ]);
}

function applicableTradeTax(invoice: Invoice): XmlNode[] {
  return invoice.vatBreakdown.map((row) =>
    node("ram:ApplicableTradeTax", [
      el(ciiRow("vatBreakdown.{i}.taxAmount"), amount(row.taxAmount)),
      { name: "ram:TypeCode", text: CII_TAX_TYPE_CODE },
      el(ciiRow("vatBreakdown.{i}.reason"), row.reason),
      el(ciiRow("vatBreakdown.{i}.taxableAmount"), amount(row.taxableAmount)),
      el(ciiRow("vatBreakdown.{i}.category"), row.category),
      el(ciiRow("vatBreakdown.{i}.vatexCode"), row.vatexCode),
      el(ciiRow("vatBreakdown.{i}.rate"), format(row.rate, RATE_DP)),
    ]),
  );
}

function monetarySummation(invoice: Invoice): XmlNode {
  const totals = invoice.totals;
  return node("ram:SpecifiedTradeSettlementHeaderMonetarySummation", [
    el(ciiRow("totals.lineExtension"), amount(totals.lineExtension)),
    el(ciiRow("totals.charge"), amount(totals.charge)),
    el(ciiRow("totals.allowance"), amount(totals.allowance)),
    el(ciiRow("totals.taxExclusive"), amount(totals.taxExclusive)),
    el(ciiRow("totals.taxAmount"), amount(totals.taxAmount), { currencyID: invoice.currency }),
    el(ciiRow("totals.rounding"), amount(totals.rounding)),
    el(ciiRow("totals.taxInclusive"), amount(totals.taxInclusive)),
    el(ciiRow("totals.prepaid"), amount(totals.prepaid)),
    el(ciiRow("totals.payable"), amount(totals.payable)),
  ]);
}

function headerTradeSettlement(invoice: Invoice): XmlNode {
  const payment = invoice.payment;
  const preceding = invoice.references?.precedingInvoice;
  return node("ram:ApplicableHeaderTradeSettlement", [
    el(ciiRow("payment.remittanceInformation"), payment.remittanceInformation),
    el(ciiRow("currency"), invoice.currency),
    group("ram:SpecifiedTradeSettlementPaymentMeans", [
      el(ciiRow("payment.meansCode"), payment.meansCode),
      el(ciiRow("payment.meansText"), payment.meansText),
      group("ram:PayeePartyCreditorFinancialAccount", [
        el(ciiRow("payment.iban"), payment.iban),
        el(ciiRow("payment.accountName"), payment.accountName),
      ]),
      group("ram:PayeeSpecifiedCreditorFinancialInstitution", [
        el(ciiRow("payment.bic"), payment.bic),
      ]),
    ]),
    ...applicableTradeTax(invoice),
    group("ram:SpecifiedTradePaymentTerms", [
      el(ciiRow("payment.terms"), payment.terms),
      dateNode("ram:DueDateDateTime", "dueDate", invoice.dueDate),
    ]),
    monetarySummation(invoice),
    group("ram:InvoiceReferencedDocument", [
      el(ciiRow("references.precedingInvoice.number"), preceding?.number),
      dateNode(
        "ram:FormattedIssueDateTime",
        "references.precedingInvoice.issueDate",
        preceding?.issueDate,
      ),
    ]),
  ]);
}

export function writeCii(invoice: Invoice): string {
  const root = node(
    "rsm:CrossIndustryInvoice",
    [
      node("rsm:ExchangedDocumentContext", [
        node("ram:GuidelineSpecifiedDocumentContextParameter", [
          el(ciiConstantRow("BT-24"), CII_GUIDELINE_ID),
        ]),
      ]),
      node("rsm:ExchangedDocument", [
        el(ciiRow("number"), invoice.number),
        el(ciiRow("typeCode"), invoice.typeCode),
        dateNode("ram:IssueDateTime", "issueDate", invoice.issueDate),
        group("ram:IncludedNote", [el(ciiRow("note"), invoice.note)]),
      ]),
      node("rsm:SupplyChainTradeTransaction", [
        ...tradeLines(invoice),
        headerTradeAgreement(invoice),
        headerTradeDelivery(invoice),
        headerTradeSettlement(invoice),
      ]),
    ],
    CII_NAMESPACES,
  );
  return serialize(root);
}
