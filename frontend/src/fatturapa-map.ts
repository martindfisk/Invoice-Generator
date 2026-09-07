import { isZero } from "./decimal";
import type { MappingRow, VatCategory } from "./model";

export const FATTURAPA_NAMESPACE = "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2";

export const FORMATO_TRASMISSIONE_B2B = "FPR12";

export const FORMATO_TRASMISSIONE_B2G = "FPA12";

export const CODICE_DESTINATARIO_LENGTH_B2G = 6;

export const FATTURAPA_SPEC = "FatturaPA 1.9.1 / XSD FatturaOrdinaria v1.2.x";

export const REGIME_FISCALE_DEFAULT = "RF01";

export const ESIGIBILITA_DEFAULT = "I";

export const TIPO_DOCUMENTO: Record<"380" | "381", string> = {
  "380": "TD01",
  "381": "TD04",
};

export const TIPO_DOCUMENTO_REVERSE: Record<string, "380" | "381"> = {
  TD01: "380",
  TD04: "381",
};

export const NATURA_CATEGORY: Record<string, VatCategory> = {
  N1: "E",
  "N2.1": "O",
  "N2.2": "O",
  "N3.1": "G",
  "N3.2": "K",
  "N3.3": "G",
  "N3.4": "G",
  "N3.5": "E",
  "N3.6": "E",
  N4: "E",
  N5: "E",
  "N6.1": "AE",
  "N6.2": "AE",
  "N6.3": "AE",
  "N6.4": "AE",
  "N6.5": "AE",
  "N6.6": "AE",
  "N6.7": "AE",
  "N6.8": "AE",
  "N6.9": "AE",
  N7: "E",
};

export const MODALITA_PAGAMENTO_MEANS: Record<string, string> = {
  MP01: "10",
  MP02: "20",
  MP03: "20",
  MP05: "30",
  MP08: "48",
  MP12: "49",
  MP19: "59",
  MP20: "59",
  MP21: "59",
  MP23: "68",
};

export const CODICE_DESTINATARIO_DOMESTIC = "0000000";

export const CODICE_DESTINATARIO_FOREIGN = "XXXXXXX";

const HEADER = "p:FatturaElettronica/FatturaElettronicaHeader";
const TRANSMISSION = `${HEADER}/DatiTrasmissione`;
const SELLER = `${HEADER}/CedentePrestatore`;
const BUYER = `${HEADER}/CessionarioCommittente`;
const BODY = "p:FatturaElettronica/FatturaElettronicaBody";
const GENERAL = `${BODY}/DatiGenerali/DatiGeneraliDocumento`;
const DETAIL = `${BODY}/DatiBeniServizi/DettaglioLinee[{i}]`;
const SUMMARY = `${BODY}/DatiBeniServizi/DatiRiepilogo[{i}]`;
const PAYMENT = `${BODY}/DatiPagamento`;
const PAYMENT_DETAIL = `${PAYMENT}/DettaglioPagamento`;

export const FATTURAPA_MAP: MappingRow[] = [
  {
    field: "seller.address.country",
    path: `${TRANSMISSION}/IdTrasmittente/IdPaese`,
    fpa: "1.1.1.1",
    label: "Transmitter country code",
  },
  {
    field: "seller.taxId",
    path: `${TRANSMISSION}/IdTrasmittente/IdCodice`,
    fpa: "1.1.1.2",
    label: "Transmitter fiscal identifier",
  },
  {
    field: "number",
    path: `${TRANSMISSION}/ProgressivoInvio`,
    fpa: "1.1.2",
    label: "Transmission progressive number",
  },
  {
    field: "",
    path: `${TRANSMISSION}/FormatoTrasmissione`,
    fpa: "1.1.3",
    label: "Transmission format (FPR12 B2B/B2C, FPA12 B2G)",
  },
  {
    field: "buyer.channel.codiceDestinatario",
    path: `${TRANSMISSION}/CodiceDestinatario`,
    fpa: "1.1.4",
    bt: "BT-49",
    label: "SDI destination code",
  },
  {
    field: "buyer.channel.pec",
    path: `${TRANSMISSION}/PECDestinatario`,
    fpa: "1.1.6",
    bt: "BT-49",
    label: "Recipient PEC address",
  },

  {
    field: "seller.vatId",
    path: `${SELLER}/DatiAnagrafici/IdFiscaleIVA/IdPaese`,
    fpa: "1.2.1.1.1",
    bt: "BT-31",
    label: "Seller VAT country code",
  },
  {
    field: "seller.vatId",
    path: `${SELLER}/DatiAnagrafici/IdFiscaleIVA/IdCodice`,
    fpa: "1.2.1.1.2",
    bt: "BT-31",
    label: "Seller VAT identifier",
  },
  {
    field: "seller.taxId",
    path: `${SELLER}/DatiAnagrafici/CodiceFiscale`,
    fpa: "1.2.1.2",
    bt: "BT-32",
    label: "Seller tax registration identifier (codice fiscale)",
  },
  {
    field: "seller.name",
    path: `${SELLER}/DatiAnagrafici/Anagrafica/Denominazione`,
    fpa: "1.2.1.3.1",
    bt: "BT-27",
    label: "Seller name",
  },
  {
    field: "seller.person.forename",
    path: `${SELLER}/DatiAnagrafici/Anagrafica/Nome`,
    fpa: "1.2.1.3.2",
    label:
      "Seller forename - AnagraficaType is a choice, so Nome + Cognome replace Denominazione for a sole trader or professional (XSD 1.2.3)",
  },
  {
    field: "seller.person.surname",
    path: `${SELLER}/DatiAnagrafici/Anagrafica/Cognome`,
    fpa: "1.2.1.3.3",
    label: "Seller surname - written only together with Nome, never beside Denominazione",
  },
  {
    field: "seller.it.regimeFiscale",
    path: `${SELLER}/DatiAnagrafici/RegimeFiscale`,
    fpa: "1.2.1.8",
    label: "Seller tax regime (RF01-RF20)",
  },
  {
    field: "seller.address.street",
    path: `${SELLER}/Sede/Indirizzo`,
    fpa: "1.2.2.1",
    bt: "BT-35",
    label: "Seller address line 1",
  },
  {
    field: "seller.address.number",
    path: `${SELLER}/Sede/NumeroCivico`,
    fpa: "1.2.2.2",
    bt: "BT-36",
    label: "Seller street number",
  },
  {
    field: "seller.address.postCode",
    path: `${SELLER}/Sede/CAP`,
    fpa: "1.2.2.3",
    bt: "BT-38",
    label: "Seller post code",
  },
  {
    field: "seller.address.city",
    path: `${SELLER}/Sede/Comune`,
    fpa: "1.2.2.4",
    bt: "BT-37",
    label: "Seller city",
  },
  {
    field: "seller.address.region",
    path: `${SELLER}/Sede/Provincia`,
    fpa: "1.2.2.5",
    bt: "BT-39",
    label: "Seller province",
  },
  {
    field: "seller.address.country",
    path: `${SELLER}/Sede/Nazione`,
    fpa: "1.2.2.6",
    bt: "BT-40",
    label: "Seller country code",
  },
  {
    field: "seller.it.rea.office",
    path: `${SELLER}/IscrizioneREA/Ufficio`,
    fpa: "1.2.4.1",
    bt: "BT-30",
    label: "REA registration office",
  },
  {
    field: "seller.it.rea.number",
    path: `${SELLER}/IscrizioneREA/NumeroREA`,
    fpa: "1.2.4.2",
    bt: "BT-30",
    label: "REA registration number",
  },
  {
    field: "seller.it.rea.capital",
    path: `${SELLER}/IscrizioneREA/CapitaleSociale`,
    fpa: "1.2.4.3",
    bt: "BT-33",
    label: "Share capital",
  },
  {
    field: "seller.it.rea.soleShareholder",
    path: `${SELLER}/IscrizioneREA/SocioUnico`,
    fpa: "1.2.4.4",
    bt: "BT-33",
    label: "Sole shareholder indicator",
  },
  {
    field: "seller.it.rea.liquidation",
    path: `${SELLER}/IscrizioneREA/StatoLiquidazione`,
    fpa: "1.2.4.5",
    bt: "BT-33",
    label: "Liquidation status",
  },
  {
    field: "seller.contact.phone",
    path: `${SELLER}/Contatti/Telefono`,
    fpa: "1.2.5.1",
    bt: "BT-42",
    label: "Seller contact telephone number",
  },
  {
    field: "seller.contact.email",
    path: `${SELLER}/Contatti/Email`,
    fpa: "1.2.5.3",
    bt: "BT-43",
    label: "Seller contact email address",
  },

  {
    field: "buyer.vatId",
    path: `${BUYER}/DatiAnagrafici/IdFiscaleIVA/IdPaese`,
    fpa: "1.4.1.1.1",
    bt: "BT-48",
    label: "Buyer VAT country code",
  },
  {
    field: "buyer.vatId",
    path: `${BUYER}/DatiAnagrafici/IdFiscaleIVA/IdCodice`,
    fpa: "1.4.1.1.2",
    bt: "BT-48",
    label: "Buyer VAT identifier",
  },
  {
    field: "buyer.taxId",
    path: `${BUYER}/DatiAnagrafici/CodiceFiscale`,
    fpa: "1.4.1.2",
    bt: "BT-46",
    label: "Buyer fiscal code",
  },
  {
    field: "buyer.name",
    path: `${BUYER}/DatiAnagrafici/Anagrafica/Denominazione`,
    fpa: "1.4.1.3.1",
    bt: "BT-44",
    label: "Buyer name",
  },
  {
    field: "buyer.person.forename",
    path: `${BUYER}/DatiAnagrafici/Anagrafica/Nome`,
    fpa: "1.4.1.3.2",
    label:
      "Buyer forename - a private individual (B2C) is named by Nome + Cognome and carries CodiceFiscale without IdFiscaleIVA",
  },
  {
    field: "buyer.person.surname",
    path: `${BUYER}/DatiAnagrafici/Anagrafica/Cognome`,
    fpa: "1.4.1.3.3",
    label: "Buyer surname - written only together with Nome, never beside Denominazione",
  },
  {
    field: "buyer.address.street",
    path: `${BUYER}/Sede/Indirizzo`,
    fpa: "1.4.2.1",
    bt: "BT-50",
    label: "Buyer address line 1",
  },
  {
    field: "buyer.address.number",
    path: `${BUYER}/Sede/NumeroCivico`,
    fpa: "1.4.2.2",
    bt: "BT-51",
    label: "Buyer street number",
  },
  {
    field: "buyer.address.postCode",
    path: `${BUYER}/Sede/CAP`,
    fpa: "1.4.2.3",
    bt: "BT-53",
    label: "Buyer post code",
  },
  {
    field: "buyer.address.city",
    path: `${BUYER}/Sede/Comune`,
    fpa: "1.4.2.4",
    bt: "BT-52",
    label: "Buyer city",
  },
  {
    field: "buyer.address.region",
    path: `${BUYER}/Sede/Provincia`,
    fpa: "1.4.2.5",
    bt: "BT-54",
    label: "Buyer province",
  },
  {
    field: "buyer.address.country",
    path: `${BUYER}/Sede/Nazione`,
    fpa: "1.4.2.6",
    bt: "BT-55",
    label: "Buyer country code",
  },

  {
    field: "typeCode",
    path: `${GENERAL}/TipoDocumento`,
    fpa: "2.1.1.1",
    bt: "BT-3",
    label: "Document type (TD01-TD29)",
  },
  {
    field: "currency",
    path: `${GENERAL}/Divisa`,
    fpa: "2.1.1.2",
    bt: "BT-5",
    label: "Invoice currency code",
  },
  {
    field: "issueDate",
    path: `${GENERAL}/Data`,
    fpa: "2.1.1.3",
    bt: "BT-2",
    label: "Invoice issue date",
  },
  {
    field: "number",
    path: `${GENERAL}/Numero`,
    fpa: "2.1.1.4",
    bt: "BT-1",
    label: "Invoice number",
  },
  {
    field: "totals.taxInclusive",
    path: `${GENERAL}/ImportoTotaleDocumento`,
    fpa: "2.1.1.9",
    bt: "BT-112",
    label: "Document total amount (net of discount, inclusive of VAT charged to the buyer)",
  },
  {
    field: "totals.rounding",
    path: `${GENERAL}/Arrotondamento`,
    fpa: "2.1.1.10",
    bt: "BT-114",
    label: "Rounding amount",
  },
  {
    field: "note",
    path: `${GENERAL}/Causale`,
    fpa: "2.1.1.11",
    bt: "BT-22",
    label: "Invoice note",
  },
  {
    field: "references.purchaseOrder",
    path: `${BODY}/DatiGenerali/DatiOrdineAcquisto/IdDocumento`,
    fpa: "2.1.2.2",
    bt: "BT-13",
    label: "Purchase order reference",
  },
  {
    field: "references.contract",
    path: `${BODY}/DatiGenerali/DatiContratto/IdDocumento`,
    fpa: "2.1.3.2",
    bt: "BT-12",
    label: "Contract reference",
  },
  {
    field: "references.tenderOrLot",
    path: `${BODY}/DatiGenerali/DatiConvenzione/IdDocumento`,
    fpa: "2.1.4.2",
    bt: "BT-17",
    label: "Tender or lot reference (convenzione, e.g. a Consip framework agreement)",
  },
  {
    field: "references.invoicedObject",
    path: `${BODY}/DatiGenerali/DatiRicezione/IdDocumento`,
    fpa: "2.1.5.2",
    bt: "BT-18",
    label: "Invoiced object identifier (nearest FatturaPA slot: DatiRicezione, specs 1.9.1)",
  },
  {
    field: "references.precedingInvoice.number",
    path: `${BODY}/DatiGenerali/DatiFattureCollegate/IdDocumento`,
    fpa: "2.1.6.2",
    bt: "BT-25",
    label: "Preceding invoice reference",
  },
  {
    field: "references.precedingInvoice.issueDate",
    path: `${BODY}/DatiGenerali/DatiFattureCollegate/Data`,
    fpa: "2.1.6.3",
    bt: "BT-26",
    label: "Preceding invoice issue date",
  },
  {
    field: "references.despatchAdvice.number",
    path: `${BODY}/DatiGenerali/DatiDDT/NumeroDDT`,
    fpa: "2.1.8.1",
    bt: "BT-16",
    label: "Despatch advice reference (numero del documento di trasporto)",
  },
  {
    field: "references.despatchAdvice.issueDate",
    path: `${BODY}/DatiGenerali/DatiDDT/DataDDT`,
    fpa: "2.1.8.2",
    bt: "BT-16",
    label: "Despatch advice date - mandatory inside DatiDDT (XSD 1.2.3)",
  },

  {
    field: "it.bollo.virtuale",
    path: `${GENERAL}/DatiBollo/BolloVirtuale`,
    fpa: "2.1.1.6.1",
    label: "Virtual stamp duty indicator (DPR 642/1972)",
  },
  {
    field: "it.bollo.amount",
    path: `${GENERAL}/DatiBollo/ImportoBollo`,
    fpa: "2.1.1.6.2",
    label: "Stamp duty amount (marca da bollo, EUR 2.00)",
  },
  {
    field: "it.cup",
    path: `${BODY}/DatiGenerali/DatiOrdineAcquisto/CodiceCUP`,
    fpa: "2.1.2.6",
    label: "CUP - codice unitario progetto (L. 3/2003 art. 11)",
  },
  {
    field: "it.cig",
    path: `${BODY}/DatiGenerali/DatiOrdineAcquisto/CodiceCIG`,
    fpa: "2.1.2.7",
    label: "CIG - codice identificativo gara (L. 136/2010 art. 3)",
  },

  {
    field: "lines.{i}.id",
    path: `${DETAIL}/NumeroLinea`,
    fpa: "2.2.1.1",
    bt: "BT-126",
    label: "Invoice line identifier",
  },
  {
    field: "lines.{i}.name",
    path: `${DETAIL}/Descrizione`,
    fpa: "2.2.1.4",
    bt: "BT-153",
    label: "Item name",
  },
  {
    field: "lines.{i}.quantity",
    path: `${DETAIL}/Quantita`,
    fpa: "2.2.1.5",
    bt: "BT-129",
    label: "Invoiced quantity",
  },
  {
    field: "lines.{i}.unitCode",
    path: `${DETAIL}/UnitaMisura`,
    fpa: "2.2.1.6",
    bt: "BT-130",
    label: "Invoiced quantity unit of measure",
  },
  {
    field: "lines.{i}.unitPriceNet",
    path: `${DETAIL}/PrezzoUnitario`,
    fpa: "2.2.1.9",
    bt: "BT-146",
    label: "Item net price",
  },
  {
    field: "lines.{i}.netAmount",
    path: `${DETAIL}/PrezzoTotale`,
    fpa: "2.2.1.11",
    bt: "BT-131",
    label: "Invoice line net amount",
  },
  {
    field: "lines.{i}.vat.rate",
    path: `${DETAIL}/AliquotaIVA`,
    fpa: "2.2.1.12",
    bt: "BT-152",
    label: "Invoiced item VAT rate",
  },
  {
    field: "lines.{i}.vat.natura",
    path: `${DETAIL}/Natura`,
    fpa: "2.2.1.14",
    bt: "BT-151",
    label: "VAT nature code (N1-N7)",
  },

  {
    field: "lines.{i}.it.altriDatiGestionali.tipoDato",
    path: `${DETAIL}/AltriDatiGestionali/TipoDato`,
    fpa: "2.2.1.16.1",
    label: "Management data type (e.g. INTENTO)",
  },
  {
    field: "lines.{i}.it.altriDatiGestionali.riferimentoTesto",
    path: `${DETAIL}/AltriDatiGestionali/RiferimentoTesto`,
    fpa: "2.2.1.16.2",
    label: "Management data text reference",
  },
  {
    field: "lines.{i}.it.altriDatiGestionali.riferimentoNumero",
    path: `${DETAIL}/AltriDatiGestionali/RiferimentoNumero`,
    fpa: "2.2.1.16.3",
    label: "Management data numeric reference",
  },
  {
    field: "lines.{i}.it.altriDatiGestionali.riferimentoData",
    path: `${DETAIL}/AltriDatiGestionali/RiferimentoData`,
    fpa: "2.2.1.16.4",
    label: "Management data date reference",
  },

  {
    field: "vatBreakdown.{i}.rate",
    path: `${SUMMARY}/AliquotaIVA`,
    fpa: "2.2.2.1",
    bt: "BT-119",
    label: "VAT category rate",
  },
  {
    field: "vatBreakdown.{i}.natura",
    path: `${SUMMARY}/Natura`,
    fpa: "2.2.2.2",
    bt: "BT-118",
    label: "VAT nature code (N1-N7)",
  },
  {
    field: "vatBreakdown.{i}.taxableAmount",
    path: `${SUMMARY}/ImponibileImporto`,
    fpa: "2.2.2.5",
    bt: "BT-116",
    label: "VAT category taxable amount",
  },
  {
    field: "vatBreakdown.{i}.taxAmount",
    path: `${SUMMARY}/Imposta`,
    fpa: "2.2.2.6",
    bt: "BT-117",
    label: "VAT category tax amount",
  },
  {
    field: "vatBreakdown.{i}.esigibilita",
    path: `${SUMMARY}/EsigibilitaIVA`,
    fpa: "2.2.2.7",
    bt: "BT-8",
    label: "VAT chargeability (I/D/S)",
  },
  {
    field: "vatBreakdown.{i}.reason",
    path: `${SUMMARY}/RiferimentoNormativo`,
    fpa: "2.2.2.8",
    bt: "BT-120",
    label: "VAT exemption reason text",
  },

  {
    field: "payment.conditions",
    path: `${PAYMENT}/CondizioniPagamento`,
    fpa: "2.4.1",
    label: "Payment conditions (TP01/TP02/TP03)",
  },
  {
    field: "payment.accountName",
    path: `${PAYMENT_DETAIL}/Beneficiario`,
    fpa: "2.4.2.1",
    bt: "BT-85",
    label: "Payment account name",
  },
  {
    field: "payment.italianMeansCode",
    path: `${PAYMENT_DETAIL}/ModalitaPagamento`,
    fpa: "2.4.2.2",
    bt: "BT-81",
    label: "Payment means (MP01-MP23)",
  },
  {
    field: "dueDate",
    path: `${PAYMENT_DETAIL}/DataScadenzaPagamento`,
    fpa: "2.4.2.5",
    bt: "BT-9",
    label: "Payment due date",
  },
  {
    field: "totals.payable",
    path: `${PAYMENT_DETAIL}/ImportoPagamento`,
    fpa: "2.4.2.6",
    bt: "BT-115",
    label: "Amount due for payment",
  },
  {
    field: "payment.iban",
    path: `${PAYMENT_DETAIL}/IBAN`,
    fpa: "2.4.2.13",
    bt: "BT-84",
    label: "Payment account identifier (IBAN)",
  },
  {
    field: "payment.bic",
    path: `${PAYMENT_DETAIL}/BIC`,
    fpa: "2.4.2.16",
    bt: "BT-86",
    label: "Payment service provider identifier (BIC)",
  },
];

export function fpaRow(fpa: string): MappingRow {
  const row = FATTURAPA_MAP.find((candidate) => candidate.fpa === fpa);
  if (!row) throw new Error(`fatturapa-map: no row for ${fpa}`);
  return row;
}

export function categoryForNatura(natura: string | undefined, rate: string): VatCategory {
  if (!natura) return isZero(rate) ? "Z" : "S";
  const category = NATURA_CATEGORY[natura];
  if (!category) throw new Error(`fatturapa-map: unknown Natura code "${natura}"`);
  return category;
}
