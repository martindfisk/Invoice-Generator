import { add, format, sum } from "./decimal";
import {
  MODALITA_PAGAMENTO_MEANS,
  TIPO_DOCUMENTO_REVERSE,
  categoryForNatura,
} from "./fatturapa-map";
import type {
  Buyer,
  Channel,
  Contact,
  Invoice,
  ItalianDocument,
  ItalianLine,
  ItalianParty,
  Line,
  Party,
  Payment,
  Person,
  References,
  Totals,
  VatBreakdownRow,
} from "./model";

const AMOUNT_DP = 2;

function parseDocument(xml: string): Element {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const failure = document.getElementsByTagName("parsererror")[0];
  if (failure) throw new Error(`fatturapa-parse: ${failure.textContent ?? "malformed XML"}`);
  const root = document.documentElement;
  if (!root || root.localName !== "FatturaElettronica") {
    throw new Error(
      `fatturapa-parse: expected a <FatturaElettronica> root, got <${root?.localName ?? "?"}>`,
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

function vatId(anagrafici: Element | null): string | undefined {
  const country = text(anagrafici, "IdFiscaleIVA", "IdPaese");
  const code = text(anagrafici, "IdFiscaleIVA", "IdCodice");
  return country && code ? `${country}${code}` : undefined;
}

function contact(party: Element | null): Contact | undefined {
  const element = child(party, "Contatti");
  if (!element) return undefined;
  const value: Contact = { phone: text(element, "Telefono"), email: text(element, "Email") };
  return value.phone || value.email ? value : undefined;
}

function italian(seller: Element | null): ItalianParty | undefined {
  const regimeFiscale = text(seller, "DatiAnagrafici", "RegimeFiscale");
  if (!regimeFiscale) return undefined;
  const rea = child(seller, "IscrizioneREA");
  const soleShareholder = text(rea, "SocioUnico");
  const liquidation = text(rea, "StatoLiquidazione");
  return {
    regimeFiscale,
    rea: rea
      ? {
          office: required(rea, "Ufficio"),
          number: required(rea, "NumeroREA"),
          capital: text(rea, "CapitaleSociale"),
          soleShareholder:
            soleShareholder === "SU" || soleShareholder === "SM" ? soleShareholder : undefined,
          liquidation: liquidation === "LS" ? "LS" : "LN",
        }
      : undefined,
  };
}

// AnagraficaType is a choice: Denominazione, or Nome + Cognome for a natural person. The model
// keeps `name` as the single BT-27/BT-44 carrier, so a person's name is rebuilt as "Nome Cognome"
// and the split is preserved in `person`. Gender has no FatturaPA element and is not recovered.
function person(anagrafici: Element | null): Person | undefined {
  const anagrafica = child(anagrafici, "Anagrafica");
  const forename = text(anagrafica, "Nome");
  const surname = text(anagrafica, "Cognome");
  return forename && surname ? { forename, surname } : undefined;
}

function partyName(anagrafici: Element | null, natural: Person | undefined): string {
  if (natural) return `${natural.forename} ${natural.surname}`;
  return required(anagrafici, "Anagrafica", "Denominazione");
}

function party(element: Element | null): Party {
  const anagrafici = child(element, "DatiAnagrafici");
  const sede = child(element, "Sede");
  const natural = person(anagrafici);
  return {
    name: partyName(anagrafici, natural),
    person: natural,
    vatId: vatId(anagrafici),
    taxId: text(anagrafici, "CodiceFiscale"),
    address: {
      street: required(sede, "Indirizzo"),
      number: text(sede, "NumeroCivico"),
      city: required(sede, "Comune"),
      postCode: required(sede, "CAP"),
      region: text(sede, "Provincia"),
      country: required(sede, "Nazione"),
    },
    contact: contact(element),
  };
}

function channel(transmission: Element | null): Channel {
  return {
    kind: "SDI",
    codiceDestinatario: required(transmission, "CodiceDestinatario"),
    pec: text(transmission, "PECDestinatario"),
  };
}

function references(general: Element | null): References | undefined {
  const preceding = child(general, "DatiFattureCollegate");
  const ddt = child(general, "DatiDDT");
  const value: References = {
    contract: text(general, "DatiContratto", "IdDocumento"),
    purchaseOrder: text(general, "DatiOrdineAcquisto", "IdDocumento"),
    despatchAdvice: ddt
      ? { number: required(ddt, "NumeroDDT"), issueDate: text(ddt, "DataDDT") }
      : undefined,
    tenderOrLot: text(general, "DatiConvenzione", "IdDocumento"),
    invoicedObject: text(general, "DatiRicezione", "IdDocumento"),
    precedingInvoice: preceding
      ? { number: required(preceding, "IdDocumento"), issueDate: text(preceding, "Data") }
      : undefined,
  };
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

function italianDocument(
  general: Element | null,
  order: Element | null,
): ItalianDocument | undefined {
  const bolloVirtuale = text(general, "DatiBollo", "BolloVirtuale");
  const value: ItalianDocument = {
    bollo:
      bolloVirtuale === "SI"
        ? { virtuale: "SI", amount: text(general, "DatiBollo", "ImportoBollo") ?? "0.00" }
        : undefined,
    cup: text(order, "CodiceCUP"),
    cig: text(order, "CodiceCIG"),
  };
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

function managementData(line: Element): ItalianLine | undefined {
  const block = child(line, "AltriDatiGestionali");
  const tipoDato = text(block, "TipoDato");
  if (!tipoDato) return undefined;
  return {
    altriDatiGestionali: {
      tipoDato,
      riferimentoTesto: text(block, "RiferimentoTesto"),
      riferimentoNumero: text(block, "RiferimentoNumero"),
      riferimentoData: text(block, "RiferimentoData"),
    },
  };
}

function lines(goods: Element | null): Line[] {
  return children(goods, "DettaglioLinee").map((line) => {
    const natura = text(line, "Natura");
    const rate = required(line, "AliquotaIVA");
    return {
      id: required(line, "NumeroLinea"),
      name: required(line, "Descrizione"),
      quantity: required(line, "Quantita"),
      unitCode: required(line, "UnitaMisura"),
      unitPriceNet: required(line, "PrezzoUnitario"),
      netAmount: required(line, "PrezzoTotale"),
      vat: { category: categoryForNatura(natura, rate), rate, natura },
      it: managementData(line),
    };
  });
}

function breakdown(goods: Element | null): VatBreakdownRow[] {
  return children(goods, "DatiRiepilogo").map((row) => {
    const natura = text(row, "Natura");
    const rate = required(row, "AliquotaIVA");
    const esigibilita = text(row, "EsigibilitaIVA");
    return {
      category: categoryForNatura(natura, rate),
      rate,
      taxableAmount: required(row, "ImponibileImporto"),
      taxAmount: required(row, "Imposta"),
      natura,
      reason: text(row, "RiferimentoNormativo"),
      esigibilita:
        esigibilita === "D" || esigibilita === "S" || esigibilita === "I" ? esigibilita : undefined,
    };
  });
}

function payment(body: Element | null): Payment {
  const block = child(body, "DatiPagamento");
  const detail = child(block, "DettaglioPagamento");
  const conditions = text(block, "CondizioniPagamento");
  const italianMeansCode = text(detail, "ModalitaPagamento");
  return {
    meansCode: italianMeansCode ? (MODALITA_PAGAMENTO_MEANS[italianMeansCode] ?? "1") : "",
    italianMeansCode,
    conditions:
      conditions === "TP01" || conditions === "TP02" || conditions === "TP03"
        ? conditions
        : undefined,
    accountName: text(detail, "Beneficiario"),
    iban: text(detail, "IBAN"),
    bic: text(detail, "BIC"),
  };
}

function totals(
  general: Element | null,
  lines: Line[],
  rows: VatBreakdownRow[],
  paymentAmount?: string,
): Totals {
  const lineExtension = format(sum(lines.map((line) => line.netAmount)), AMOUNT_DP);
  const taxExclusive = format(sum(rows.map((row) => row.taxableAmount)), AMOUNT_DP);
  const taxAmount = format(sum(rows.map((row) => row.taxAmount)), AMOUNT_DP);
  // 2.1.1.9 ImportoTotaleDocumento is the VAT-inclusive document total (BT-112). The amount
  // actually due (BT-115) is 2.4.2.6 ImportoPagamento; the two differ once anything is prepaid.
  const taxInclusive =
    text(general, "ImportoTotaleDocumento") ?? format(add(taxExclusive, taxAmount), AMOUNT_DP);
  return {
    lineExtension,
    taxExclusive,
    taxAmount,
    taxInclusive,
    rounding: text(general, "Arrotondamento"),
    payable: paymentAmount ?? taxInclusive,
  };
}

export function parseFatturapa(xml: string): Invoice {
  const root = parseDocument(xml);
  const header = child(root, "FatturaElettronicaHeader");
  const body = child(root, "FatturaElettronicaBody");
  const transmission = child(header, "DatiTrasmissione");
  const sellerElement = child(header, "CedentePrestatore");
  const general = child(body, "DatiGenerali", "DatiGeneraliDocumento");
  const goods = child(body, "DatiBeniServizi");
  const seller: Party = { ...party(sellerElement), it: italian(sellerElement) };
  const buyer: Buyer = {
    ...party(child(header, "CessionarioCommittente")),
    channel: channel(transmission),
  };
  const parsedLines = lines(goods);
  const parsedBreakdown = breakdown(goods);
  return {
    format: "fatturapa",
    number: required(general, "Numero"),
    issueDate: required(general, "Data"),
    dueDate: text(child(body, "DatiPagamento", "DettaglioPagamento"), "DataScadenzaPagamento"),
    typeCode: TIPO_DOCUMENTO_REVERSE[required(general, "TipoDocumento")] ?? "380",
    currency: required(general, "Divisa"),
    note: text(general, "Causale"),
    references: references(child(body, "DatiGenerali")),
    it: italianDocument(general, child(body, "DatiGenerali", "DatiOrdineAcquisto")),
    seller,
    buyer,
    lines: parsedLines,
    vatBreakdown: parsedBreakdown,
    payment: payment(body),
    totals: totals(
      general,
      parsedLines,
      parsedBreakdown,
      text(child(body, "DatiPagamento", "DettaglioPagamento"), "ImportoPagamento"),
    ),
  };
}
