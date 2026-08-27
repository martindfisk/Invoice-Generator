import { format } from "./decimal";
import {
  CODICE_DESTINATARIO_DOMESTIC,
  CODICE_DESTINATARIO_FOREIGN,
  CODICE_DESTINATARIO_LENGTH_B2G,
  ESIGIBILITA_DEFAULT,
  FATTURAPA_NAMESPACE,
  FORMATO_TRASMISSIONE_B2B,
  FORMATO_TRASMISSIONE_B2G,
  MODALITA_PAGAMENTO_MEANS,
  REGIME_FISCALE_DEFAULT,
  TIPO_DOCUMENTO,
  fpaRow,
} from "./fatturapa-map";
import type { Channel, DocumentReference, Invoice, Party } from "./model";
import { el, group, node, serialize, type XmlNode } from "./xml-writer";

const AMOUNT_DP = 2;

export function splitVatId(vatId: string | undefined, fallbackCountry: string) {
  if (!vatId) return { country: undefined, code: undefined };
  const match = /^([A-Za-z]{2})(.+)$/.exec(vatId);
  if (!match) return { country: fallbackCountry, code: vatId };
  return { country: match[1].toUpperCase(), code: match[2] };
}

export function progressivoInvio(number: string): string {
  const compact = number.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return compact.slice(-10) || "1";
}

export function codiceDestinatario(channel: Channel, buyerCountry: string): string {
  if (channel.kind === "SDI") return channel.codiceDestinatario;
  return buyerCountry === "IT" ? CODICE_DESTINATARIO_DOMESTIC : CODICE_DESTINATARIO_FOREIGN;
}

export function formatoTrasmissione(channel: Channel, buyerCountry: string): string {
  return codiceDestinatario(channel, buyerCountry).length === CODICE_DESTINATARIO_LENGTH_B2G
    ? FORMATO_TRASMISSIONE_B2G
    : FORMATO_TRASMISSIONE_B2B;
}

export function modalitaPagamento(italianMeansCode: string | undefined, meansCode: string): string {
  if (italianMeansCode) return italianMeansCode;
  const found = Object.entries(MODALITA_PAGAMENTO_MEANS).find(([, code]) => code === meansCode);
  return found ? found[0] : "MP05";
}

// AnagraficaType (XSD 1.2.3) is an xs:choice: either Denominazione, or Nome followed by Cognome.
// A natural person therefore never carries both, and a consumer buyer identified by codice fiscale
// alone leaves IdFiscaleIVA out entirely — DatiAnagraficiCessionarioType makes both optional and
// requires only Anagrafica, and SDI check 00417 is satisfied by CodiceFiscale.
function anagrafica(prefix: "1.2" | "1.4", party: Party): XmlNode {
  const isSeller = prefix === "1.2";
  const person = party.person;
  if (person) {
    return node("Anagrafica", [
      el(fpaRow(isSeller ? "1.2.1.3.2" : "1.4.1.3.2"), person.forename),
      el(fpaRow(isSeller ? "1.2.1.3.3" : "1.4.1.3.3"), person.surname),
    ]);
  }
  return node("Anagrafica", [el(fpaRow(isSeller ? "1.2.1.3.1" : "1.4.1.3.1"), party.name)]);
}

function anagrafici(prefix: "1.2" | "1.4", party: Party): XmlNode {
  const vat = splitVatId(party.vatId, party.address.country);
  const isSeller = prefix === "1.2";
  return node("DatiAnagrafici", [
    group("IdFiscaleIVA", [
      el(fpaRow(isSeller ? "1.2.1.1.1" : "1.4.1.1.1"), vat.country),
      el(fpaRow(isSeller ? "1.2.1.1.2" : "1.4.1.1.2"), vat.code),
    ]),
    el(fpaRow(isSeller ? "1.2.1.2" : "1.4.1.2"), party.taxId),
    anagrafica(prefix, party),
    isSeller ? el(fpaRow("1.2.1.8"), party.it?.regimeFiscale ?? REGIME_FISCALE_DEFAULT) : null,
  ]);
}

function sede(prefix: "1.2" | "1.4", party: Party): XmlNode {
  const isSeller = prefix === "1.2";
  return node("Sede", [
    el(fpaRow(isSeller ? "1.2.2.1" : "1.4.2.1"), party.address.street),
    el(fpaRow(isSeller ? "1.2.2.2" : "1.4.2.2"), party.address.number),
    el(fpaRow(isSeller ? "1.2.2.3" : "1.4.2.3"), party.address.postCode),
    el(fpaRow(isSeller ? "1.2.2.4" : "1.4.2.4"), party.address.city),
    el(fpaRow(isSeller ? "1.2.2.5" : "1.4.2.5"), party.address.region),
    el(fpaRow(isSeller ? "1.2.2.6" : "1.4.2.6"), party.address.country),
  ]);
}

function cedentePrestatore(seller: Party): XmlNode {
  const rea = seller.it?.rea;
  return node("CedentePrestatore", [
    anagrafici("1.2", seller),
    sede("1.2", seller),
    group("IscrizioneREA", [
      el(fpaRow("1.2.4.1"), rea?.office),
      el(fpaRow("1.2.4.2"), rea?.number),
      el(
        fpaRow("1.2.4.3"),
        rea?.capital === undefined ? undefined : format(rea.capital, AMOUNT_DP),
      ),
      el(fpaRow("1.2.4.4"), rea?.soleShareholder),
      el(fpaRow("1.2.4.5"), rea?.liquidation),
    ]),
    group("Contatti", [
      el(fpaRow("1.2.5.1"), seller.contact?.phone),
      el(fpaRow("1.2.5.3"), seller.contact?.email),
    ]),
  ]);
}

function datiTrasmissione(invoice: Invoice): XmlNode {
  const seller = invoice.seller;
  const vat = splitVatId(seller.vatId, seller.address.country);
  const channel = invoice.buyer.channel;
  return node("DatiTrasmissione", [
    node("IdTrasmittente", [
      el(fpaRow("1.1.1.1"), seller.address.country || vat.country),
      el(fpaRow("1.1.1.2"), seller.taxId ?? vat.code),
    ]),
    el(fpaRow("1.1.2"), progressivoInvio(invoice.number)),
    el(fpaRow("1.1.3"), formatoTrasmissione(channel, invoice.buyer.address.country)),
    el(fpaRow("1.1.4"), codiceDestinatario(channel, invoice.buyer.address.country)),
    el(fpaRow("1.1.6"), channel.kind === "SDI" ? channel.pec : undefined),
  ]);
}

function datiDdt(despatchAdvice: DocumentReference | undefined): XmlNode | null {
  if (!despatchAdvice?.number || !despatchAdvice.issueDate) return null;
  return node("DatiDDT", [
    el(fpaRow("2.1.8.1"), despatchAdvice.number),
    el(fpaRow("2.1.8.2"), despatchAdvice.issueDate),
  ]);
}

function datiGenerali(invoice: Invoice): XmlNode {
  const references = invoice.references ?? {};
  return node("DatiGenerali", [
    node("DatiGeneraliDocumento", [
      el(fpaRow("2.1.1.1"), TIPO_DOCUMENTO[invoice.typeCode]),
      el(fpaRow("2.1.1.2"), invoice.currency),
      el(fpaRow("2.1.1.3"), invoice.issueDate),
      el(fpaRow("2.1.1.4"), invoice.number),
      group("DatiBollo", [
        el(fpaRow("2.1.1.6.1"), invoice.it?.bollo?.virtuale),
        el(
          fpaRow("2.1.1.6.2"),
          invoice.it?.bollo === undefined ? undefined : format(invoice.it.bollo.amount, AMOUNT_DP),
        ),
      ]),
      el(fpaRow("2.1.1.9"), format(invoice.totals.taxInclusive, AMOUNT_DP)),
      el(
        fpaRow("2.1.1.10"),
        invoice.totals.rounding === undefined
          ? undefined
          : format(invoice.totals.rounding, AMOUNT_DP),
      ),
      el(fpaRow("2.1.1.11"), invoice.note),
    ]),
    group("DatiOrdineAcquisto", [
      el(fpaRow("2.1.2.2"), references.purchaseOrder),
      el(fpaRow("2.1.2.6"), invoice.it?.cup),
      el(fpaRow("2.1.2.7"), invoice.it?.cig),
    ]),
    group("DatiContratto", [el(fpaRow("2.1.3.2"), references.contract)]),
    group("DatiConvenzione", [el(fpaRow("2.1.4.2"), references.tenderOrLot)]),
    group("DatiRicezione", [el(fpaRow("2.1.5.2"), references.invoicedObject)]),
    group("DatiFattureCollegate", [
      el(fpaRow("2.1.6.2"), references.precedingInvoice?.number),
      el(fpaRow("2.1.6.3"), references.precedingInvoice?.issueDate),
    ]),
    datiDdt(references.despatchAdvice),
  ]);
}

function datiBeniServizi(invoice: Invoice): XmlNode {
  const details = invoice.lines.map((line) =>
    node("DettaglioLinee", [
      el(fpaRow("2.2.1.1"), line.id),
      el(fpaRow("2.2.1.4"), line.name),
      el(fpaRow("2.2.1.5"), format(line.quantity, AMOUNT_DP)),
      el(fpaRow("2.2.1.6"), line.unitCode),
      el(fpaRow("2.2.1.9"), format(line.unitPriceNet, AMOUNT_DP)),
      el(fpaRow("2.2.1.11"), format(line.netAmount, AMOUNT_DP)),
      el(fpaRow("2.2.1.12"), format(line.vat.rate, AMOUNT_DP)),
      el(fpaRow("2.2.1.14"), line.vat.natura),
      group("AltriDatiGestionali", [
        el(fpaRow("2.2.1.16.1"), line.it?.altriDatiGestionali?.tipoDato),
        el(fpaRow("2.2.1.16.2"), line.it?.altriDatiGestionali?.riferimentoTesto),
        el(fpaRow("2.2.1.16.3"), line.it?.altriDatiGestionali?.riferimentoNumero),
        el(fpaRow("2.2.1.16.4"), line.it?.altriDatiGestionali?.riferimentoData),
      ]),
    ]),
  );
  const summaries = invoice.vatBreakdown.map((row) =>
    node("DatiRiepilogo", [
      el(fpaRow("2.2.2.1"), format(row.rate, AMOUNT_DP)),
      el(fpaRow("2.2.2.2"), row.natura),
      el(fpaRow("2.2.2.5"), format(row.taxableAmount, AMOUNT_DP)),
      el(fpaRow("2.2.2.6"), format(row.taxAmount, AMOUNT_DP)),
      el(fpaRow("2.2.2.7"), row.esigibilita ?? ESIGIBILITA_DEFAULT),
      el(fpaRow("2.2.2.8"), row.reason),
    ]),
  );
  return node("DatiBeniServizi", [...details, ...summaries]);
}

function datiPagamento(invoice: Invoice): XmlNode {
  const payment = invoice.payment;
  return node("DatiPagamento", [
    el(fpaRow("2.4.1"), payment.conditions ?? "TP02"),
    node("DettaglioPagamento", [
      el(fpaRow("2.4.2.1"), payment.accountName),
      el(fpaRow("2.4.2.2"), modalitaPagamento(payment.italianMeansCode, payment.meansCode)),
      el(fpaRow("2.4.2.5"), invoice.dueDate),
      el(fpaRow("2.4.2.6"), format(invoice.totals.payable, AMOUNT_DP)),
      el(fpaRow("2.4.2.13"), payment.iban),
      el(fpaRow("2.4.2.16"), payment.bic),
    ]),
  ]);
}

export function writeFatturapa(invoice: Invoice): string {
  const root = node(
    "p:FatturaElettronica",
    [
      node("FatturaElettronicaHeader", [
        datiTrasmissione(invoice),
        cedentePrestatore(invoice.seller),
        node("CessionarioCommittente", [
          anagrafici("1.4", invoice.buyer),
          sede("1.4", invoice.buyer),
        ]),
      ]),
      node("FatturaElettronicaBody", [
        datiGenerali(invoice),
        datiBeniServizi(invoice),
        datiPagamento(invoice),
      ]),
    ],
    {
      "xmlns:p": FATTURAPA_NAMESPACE,
      versione: formatoTrasmissione(invoice.buyer.channel, invoice.buyer.address.country),
    },
  );
  return serialize(root);
}
