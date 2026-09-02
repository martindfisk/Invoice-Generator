import type { Buyer, Invoice, Party, Payment } from "./model";

export type PresetId =
  | "it-b2b-sdi"
  | "be-peppol"
  | "broken"
  | "be-peppol-broken"
  | "de-hotel-b2b-zugferd"
  | "de-hotel-b2g-xrechnung"
  | "de-hotel-b2g-broken"
  | "it-restaurant-b2c-pec"
  | "it-restaurant-b2b-fattura"
  | "it-restaurant-b2g-fpa12"
  | "it-restaurant-td04-credit";

export const PRESET_IDS: PresetId[] = [
  "it-b2b-sdi",
  "be-peppol",
  "broken",
  "be-peppol-broken",
  "de-hotel-b2b-zugferd",
  "de-hotel-b2g-xrechnung",
  "de-hotel-b2g-broken",
  "it-restaurant-b2c-pec",
  "it-restaurant-b2b-fattura",
  "it-restaurant-b2g-fpa12",
  "it-restaurant-td04-credit",
];

export const PRESET_LABELS: Record<PresetId, string> = {
  "it-b2b-sdi": "Italian B2B (SDI)",
  "be-peppol": "Peppol BE",
  broken: "Intentionally broken",
  "be-peppol-broken": "Wrong KBO check digit",
  "de-hotel-b2b-zugferd": "Corporate guest (ZUGFeRD)",
  "de-hotel-b2g-xrechnung": "Federal traveller (XRechnung)",
  "de-hotel-b2g-broken": "Missing Leitweg-ID",
  "it-restaurant-b2c-pec": "Private guest (PEC)",
  "it-restaurant-b2b-fattura": "Business lunch (FPR12)",
  "it-restaurant-b2g-fpa12": "Ministry catering (FPA12)",
  "it-restaurant-td04-credit": "Credit note (TD04)",
};

export type PresetAudience = "B2C" | "B2B" | "B2G";

export type PresetChannel = "PEPPOL" | "SDI" | "EMAIL";

export type PresetMeta = {
  id: PresetId;
  label: string;
  group: string;
  country: "DE" | "IT" | "BE";
  audience: PresetAudience;
  formatLabel: string;
  channel: PresetChannel;
  summary: string;
  legalBasis: string;
};

export const PRESET_META: Record<PresetId, PresetMeta> = {
  "it-b2b-sdi": {
    id: "it-b2b-sdi",
    label: "Italian B2B (SDI)",
    group: "Reference",
    country: "IT",
    audience: "B2B",
    formatLabel: "FatturaPA 1.2.3 (FPR12)",
    channel: "SDI",
    summary:
      "Domestic IT invoice with a 22% and a 10% line plus an N3.5 dichiarazione d'intento line.",
    legalBasis: "D.Lgs. 127/2015 art. 1; specs 1.9.1",
  },
  "be-peppol": {
    id: "be-peppol",
    label: "Peppol BE",
    group: "Reference",
    country: "BE",
    audience: "B2B",
    formatLabel: "Peppol BIS Billing 3.0 (UBL 2.1)",
    channel: "PEPPOL",
    summary: "Belgian cross-border invoice over Peppol with a purchase-order reference.",
    legalBasis: "Belgian B2B mandate from 1 Jan 2026; Directive 2014/55/EU",
  },
  broken: {
    id: "broken",
    label: "Intentionally broken",
    group: "Reference",
    country: "IT",
    audience: "B2B",
    formatLabel: "FatturaPA / UBL",
    channel: "SDI",
    summary: "Deliberate defects: wrong VAT sum, missing buyer country, exemption without reason.",
    legalBasis: "Used to demonstrate the validation pipeline",
  },
  "be-peppol-broken": {
    id: "be-peppol-broken",
    label: "Wrong KBO check digit",
    group: "Reference",
    country: "BE",
    audience: "B2B",
    formatLabel: "Peppol BIS Billing 3.0 (UBL 2.1)",
    channel: "PEPPOL",
    summary:
      "Broken on purpose: the buyer's Belgian enterprise number ends in 96 where the mod-97 rule demands 95, so the KBO/BCE number in BT-47, the Peppol endpoint in BT-49 and the VAT id in BT-48 all fail PEPPOL-COMMON-R043.",
    legalBasis:
      "Peppol BIS Billing 3.0 (Peppol rule PEPPOL-COMMON-R043, mod-97 on ICD 0208); KBO/BCE enterprise number, Belgian B2B mandate from 1 Jan 2026",
  },
  "de-hotel-b2b-zugferd": {
    id: "de-hotel-b2b-zugferd",
    label: "Corporate guest (ZUGFeRD)",
    group: "Munich hotel (DE)",
    country: "DE",
    audience: "B2B",
    formatLabel: "CII - ZUGFeRD 2.4 / Factur-X 1.08 profile EN 16931",
    channel: "EMAIL",
    summary:
      "A corporate guest's employer needs a full invoice: three room nights at the 7% accommodation rate and a hosted business dinner (Bewirtung) at 19%, sent as a ZUGFeRD EN 16931 CII file by e-mail.",
    legalBasis:
      "UStG § 14 / Wachstumschancengesetz (B2B e-invoice receipt duty since 1 Jan 2025); EN 16931-1:2017; ZUGFeRD 2.4 / Factur-X 1.08 profile EN16931",
  },
  "de-hotel-b2g-xrechnung": {
    id: "de-hotel-b2g-xrechnung",
    label: "Federal traveller (XRechnung)",
    group: "Munich hotel (DE)",
    country: "DE",
    audience: "B2G",
    formatLabel: "XRechnung 3.0.2 (UBL 2.1)",
    channel: "PEPPOL",
    summary:
      "A federal employee on official travel: two room nights at 7% plus breakfast at 19%, billed to the authority over Peppol with the Leitweg-ID in BT-10 (mandatory under BR-DE-15).",
    legalBasis:
      "E-Rechnungsverordnung (ERechV) § 3; Directive 2014/55/EU; XRechnung 3.0.2 (KoSIT bundle 2026-01-31)",
  },
  "de-hotel-b2g-broken": {
    id: "de-hotel-b2g-broken",
    label: "Missing Leitweg-ID",
    group: "Munich hotel (DE)",
    country: "DE",
    audience: "B2G",
    formatLabel: "XRechnung 3.0.2 (UBL 2.1)",
    channel: "PEPPOL",
    summary:
      "Broken on purpose: the same federal booking without the Leitweg-ID in BT-10 and without the seller's telephone number in BT-42 - the two XRechnung CIUS additions (BR-DE-15, BR-DE-6) that EN 16931 itself never asks for.",
    legalBasis:
      "XRechnung 3.0.2 rules BR-DE-15 (BT-10 Leitweg-ID) and BR-DE-6 (BT-42); E-Rechnungsverordnung (ERechV) § 3; EN 16931-1:2017",
  },
  "it-restaurant-b2c-pec": {
    id: "it-restaurant-b2c-pec",
    label: "Private guest (PEC)",
    group: "Rome restaurants (IT)",
    country: "IT",
    audience: "B2C",
    formatLabel: "FatturaPA 1.2.3 (FPR12)",
    channel: "SDI",
    summary:
      "A dinner invoiced to a private guest: the cessionario is a natural person, so Anagrafica carries Nome and Cognome instead of Denominazione and CodiceFiscale stands alone without IdFiscaleIVA. Destination code 0000000 sends the file to her PEC address; everything is at the 10% somministrazione rate.",
    legalBasis:
      "D.Lgs. 127/2015 art. 1 c. 3 (B2C mandate since 1 Jan 2019 via L. 205/2017 art. 1 c. 909); FatturaPA specs 1.9.1 / XSD 1.2.3 AnagraficaType; DPR 633/1972 Tab. A parte III n. 121 (10%)",
  },
  "it-restaurant-b2b-fattura": {
    id: "it-restaurant-b2b-fattura",
    label: "Business lunch (FPR12)",
    group: "Rome restaurants (IT)",
    country: "IT",
    audience: "B2B",
    formatLabel: "FatturaPA 1.2.3 (FPR12)",
    channel: "SDI",
    summary:
      "A business lunch for a guest with a partita IVA: food and drinks at the 10% rate, an excluded line under Natura N1 (art. 15 disbursements) and the EUR 2.00 virtual stamp duty in DatiBollo.",
    legalBasis:
      "D.Lgs. 127/2015 art. 1 c. 3; FatturaPA specs 1.9.1 / XSD 1.2.3; DPR 633/1972 art. 15; DPR 642/1972 (bollo)",
  },
  "it-restaurant-b2g-fpa12": {
    id: "it-restaurant-b2g-fpa12",
    label: "Ministry catering (FPA12)",
    group: "Rome restaurants (IT)",
    country: "IT",
    audience: "B2G",
    formatLabel: "FatturaPA 1.2.3 (FPA12)",
    channel: "SDI",
    summary:
      "Catering a ministry event: FormatoTrasmissione FPA12 with a 6-character codice univoco ufficio, CIG and CUP on the purchase order and deferred VAT chargeability (EsigibilitaIVA D).",
    legalBasis:
      "D.M. 55/2013 (B2G obbligo); L. 136/2010 art. 3 (CIG); L. 3/2003 art. 11 (CUP); FatturaPA specs 1.9.1",
  },
  "it-restaurant-td04-credit": {
    id: "it-restaurant-td04-credit",
    label: "Credit note (TD04)",
    group: "Rome restaurants (IT)",
    country: "IT",
    audience: "B2B",
    formatLabel: "FatturaPA 1.2.3 (FPR12, TD04)",
    channel: "SDI",
    summary:
      "A TD04 nota di credito that partially reverses IT-RM-2026-0117: two covers were never consumed. DatiFattureCollegate carries the original number and date; amounts stay positive, the TD04 type code conveys the credit.",
    legalBasis:
      "DPR 633/1972 art. 26 (variazioni in diminuzione); TipoDocumento TD04, FatturaPA specs 1.9.1",
  },
};

export function listPresets(): PresetMeta[] {
  return PRESET_IDS.map((id) => PRESET_META[id]);
}

export function presetGroups(): { group: string; presets: PresetMeta[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, PresetMeta[]>();
  for (const meta of listPresets()) {
    if (!byGroup.has(meta.group)) {
      byGroup.set(meta.group, []);
      order.push(meta.group);
    }
    byGroup.get(meta.group)!.push(meta);
  }
  return order.map((group) => ({ group, presets: byGroup.get(group)! }));
}

const ISSUE_DATE = "2026-08-26";
const DUE_DATE = "2026-09-25";

const INTENTO_REASON = "Non imponibile art. 8 c. 1 lett. c) DPR 633/1972 - dichiarazione d'intento";

function italianSeller(): Party {
  return {
    name: "Bottega Alpina S.r.l.",
    tradeName: "Bottega Alpina",
    vatId: "IT01234567890",
    taxId: "01234567890",
    legalRegId: "01234567890",
    legalRegScheme: "0211",
    electronicAddress: { scheme: "0211", id: "01234567890" },
    address: {
      street: "Via Vittorio Veneto",
      number: "12",
      city: "Milano",
      postCode: "20121",
      region: "MI",
      country: "IT",
    },
    contact: {
      name: "Ufficio Fatturazione",
      phone: "+39021234567",
      email: "fatture@example.it",
    },
    it: {
      regimeFiscale: "RF01",
      rea: {
        office: "MI",
        number: "1234567",
        capital: "10000.00",
        soleShareholder: "SM",
        liquidation: "LN",
      },
    },
  };
}

function italianB2bSdi(): Invoice {
  return {
    format: "fatturapa",
    number: "IT-INV-0001",
    issueDate: ISSUE_DATE,
    dueDate: DUE_DATE,
    typeCode: "380",
    currency: "EUR",
    note: "Fattura di esempio generata dal browser",
    references: {
      purchaseOrder: "PO-2026-0042",
      buyerReference: "ORG-2026-456",
      project: "PRJ-2026-011",
      contract: "CTR-2026-114",
      despatchAdvice: { number: "DDT-2026-0077", issueDate: "2026-08-23" },
    },
    uapi: {
      series: "FT",
      buyerAccountingRef: "COSTCENTER1",
      buyer: { buyerId: "0211:09876543210", origin: "NATIONAL" },
      delivery: {
        name: "Magazzino Roma",
        address: {
          street: "Via Industriale",
          number: "99",
          city: "Roma",
          postCode: "00148",
          region: "RM",
          country: "IT",
        },
      },
    },
    seller: italianSeller(),
    buyer: {
      name: "Cantina del Sole S.p.A.",
      vatId: "IT09876543210",
      taxId: "09876543210",
      electronicAddress: { scheme: "0211", id: "09876543210" },
      address: {
        street: "Via Nazionale",
        number: "1",
        city: "Roma",
        postCode: "00184",
        region: "RM",
        country: "IT",
      },
      channel: { kind: "SDI", codiceDestinatario: "ABC1234" },
    },
    lines: [
      {
        id: "1",
        name: "Servizio di consulenza",
        description: "Consulenza tecnica su progetto e-invoicing",
        quantity: "10.00",
        unitCode: "HUR",
        unitPriceNet: "150.00",
        netAmount: "1500.00",
        vat: { category: "S", rate: "22.00" },
        // "0.00" is the shape the accepted capture in docs/reference/fatturapa/ used. A non-zero
        // BT-136 would need the writers to emit line AllowanceCharge, or Peppol's line-arithmetic
        // rule would fire against our own predicted XML.
        uapi: {
          allowance: "0.00",
          surcharge: "0.00",
          itemNumber: "MAN-2026-04",
          itemCode: "65112200",
        },
      },
      {
        id: "2",
        name: "Manuale operativo stampato",
        quantity: "20.00",
        unitCode: "H87",
        unitPriceNet: "25.00",
        netAmount: "500.00",
        vat: { category: "S", rate: "10.00" },
      },
      {
        id: "3",
        name: "Fornitura con dichiarazione d'intento",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "800.00",
        netAmount: "800.00",
        vat: { category: "E", rate: "0.00", natura: "N3.5" },
        it: {
          altriDatiGestionali: {
            tipoDato: "INTENTO",
            riferimentoTesto: "08060120345678901-000001",
            riferimentoData: "2026-01-15",
          },
        },
      },
    ],
    vatBreakdown: [
      {
        category: "S",
        rate: "22.00",
        taxableAmount: "1500.00",
        taxAmount: "330.00",
        esigibilita: "I",
      },
      {
        category: "S",
        rate: "10.00",
        taxableAmount: "500.00",
        taxAmount: "50.00",
        esigibilita: "I",
      },
      {
        category: "E",
        rate: "0.00",
        taxableAmount: "800.00",
        taxAmount: "0.00",
        natura: "N3.5",
        reason: INTENTO_REASON,
        esigibilita: "I",
      },
    ],
    payment: {
      meansCode: "30",
      meansText: "Bonifico bancario",
      italianMeansCode: "MP05",
      conditions: "TP02",
      terms: "Pagamento a 30 giorni data fattura",
      iban: "IT60X0542811101000000123456",
      accountName: "Bottega Alpina S.r.l.",
      bic: "BPMOIT22XXX",
      remittanceInformation: "IT-INV-0001",
    },
    totals: {
      lineExtension: "2800.00",
      taxExclusive: "2800.00",
      taxAmount: "380.00",
      taxInclusive: "3180.00",
      payable: "3180.00",
    },
  };
}

function belgianPeppol(): Invoice {
  return {
    format: "ubl",
    number: "BE-INV-2026-0007",
    issueDate: ISSUE_DATE,
    dueDate: DUE_DATE,
    typeCode: "380",
    currency: "EUR",
    references: {
      buyerReference: "BR-2026-77",
      purchaseOrder: "PO-BE-2026-014",
      contract: "CTR-BE-2026-9",
      project: "PRJ-BE-2026-3",
    },
    uapi: {
      buyerAccountingRef: "COST-CENTER-001",
      buyer: { buyerId: "0208:0888888895", origin: "NATIONAL" },
      delivery: {
        name: "Meuse Logistics warehouse",
        address: {
          street: "Havenlaan",
          number: "86C",
          city: "Brussel",
          postCode: "1000",
          region: "BE-BRU",
          country: "BE",
        },
      },
    },
    seller: {
      name: "Ardennes Bureau BV",
      vatId: "BE0999999922",
      legalRegId: "0999999922",
      legalRegScheme: "0208",
      electronicAddress: { scheme: "0208", id: "0999999922" },
      address: {
        street: "Rue de la Loi",
        number: "16",
        city: "Bruxelles",
        postCode: "1000",
        region: "BE-BRU",
        country: "BE",
      },
      contact: { name: "Billing", email: "billing@example.be" },
    },
    buyer: {
      name: "Meuse Logistics NV",
      vatId: "BE0888888895",
      legalRegId: "0888888895",
      legalRegScheme: "0208",
      electronicAddress: { scheme: "0208", id: "0888888895" },
      address: {
        street: "Havenlaan",
        number: "86C",
        city: "Brussel",
        postCode: "1000",
        region: "BE-BRU",
        country: "BE",
      },
      channel: { kind: "PEPPOL", participantId: "0208:0888888895" },
    },
    lines: [
      {
        id: "1",
        name: "Consultancy services",
        description: "Peppol onboarding workshop",
        quantity: "8.00",
        unitCode: "HUR",
        unitPriceNet: "125.00",
        netAmount: "1000.00",
        vat: { category: "S", rate: "21.00" },
      },
      {
        id: "2",
        name: "Project licence",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "250.00",
        netAmount: "250.00",
        vat: { category: "S", rate: "21.00" },
      },
    ],
    vatBreakdown: [{ category: "S", rate: "21.00", taxableAmount: "1250.00", taxAmount: "262.50" }],
    payment: {
      meansCode: "58",
      meansText: "SEPA credit transfer",
      conditions: "TP02",
      terms: "Payable within 30 days of the invoice date",
      iban: "BE68539007547034",
      accountName: "Ardennes Bureau BV",
      bic: "GEBABEBB",
      remittanceInformation: "BE-INV-2026-0007",
    },
    totals: {
      lineExtension: "1250.00",
      taxExclusive: "1250.00",
      taxAmount: "262.50",
      taxInclusive: "1512.50",
      payable: "1512.50",
    },
  };
}

function broken(): Invoice {
  return {
    format: "fatturapa",
    number: "BROKEN-0001",
    issueDate: ISSUE_DATE,
    dueDate: DUE_DATE,
    typeCode: "380",
    currency: "EUR",
    references: { purchaseOrder: "PO-BROKEN-0001" },
    seller: italianSeller(),
    buyer: {
      name: "Ombra Trading S.r.l.",
      vatId: "IT11111111111",
      address: {
        street: "Via Senza Paese",
        number: "9",
        city: "Napoli",
        postCode: "80100",
        region: "NA",
        country: "",
      },
      channel: { kind: "SDI", codiceDestinatario: "0000000" },
    },
    lines: [
      {
        id: "1",
        name: "Fornitura di materiali",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "1000.00",
        netAmount: "1000.00",
        vat: { category: "S", rate: "22.00" },
      },
      {
        id: "2",
        name: "Prestazione esente",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "200.00",
        netAmount: "200.00",
        vat: { category: "E", rate: "0.00", natura: "N4" },
      },
    ],
    vatBreakdown: [
      {
        category: "S",
        rate: "22.00",
        taxableAmount: "1000.00",
        taxAmount: "220.00",
        esigibilita: "I",
      },
      {
        category: "E",
        rate: "0.00",
        taxableAmount: "200.00",
        taxAmount: "0.00",
        natura: "N4",
        esigibilita: "I",
      },
    ],
    payment: {
      meansCode: "30",
      italianMeansCode: "MP05",
      conditions: "TP02",
      iban: "IT60X0542811101000000123456",
      accountName: "Bottega Alpina S.r.l.",
    },
    totals: {
      lineExtension: "1200.00",
      taxExclusive: "1200.00",
      taxAmount: "210.00",
      taxInclusive: "1410.00",
      payable: "1410.00",
    },
  };
}

const MUNICH_DUE_DATE = "2026-09-09";
const ROME_INVOICE_NUMBER = "IT-RM-2026-0117";
const ROME_INVOICE_DATE = "2026-08-24";
const ROME_INVOICE_DUE_DATE = "2026-09-23";
const ART15_REASON = "Escluso art. 15 c. 1 n. 3 DPR 633/1972 - anticipazioni in nome e per conto";

function munichHotelSeller(): Party {
  return {
    name: "Hotel Isartor Betriebs GmbH",
    tradeName: "Hotel Isartor",
    vatId: "DE811234567",
    address: {
      street: "Zweibrueckenstrasse",
      number: "8",
      city: "Muenchen",
      postCode: "80331",
      region: "Bayern",
      country: "DE",
    },
    contact: {
      name: "Rechnungswesen",
      phone: "+49 89 5551200",
      email: "rechnung@hotel-isartor.example",
    },
    electronicAddress: { scheme: "EM", id: "rechnung@hotel-isartor.example" },
  };
}

function munichHotelPayment(number: string): Payment {
  return {
    meansCode: "58",
    meansText: "SEPA-Ueberweisung",
    italianMeansCode: "MP05",
    conditions: "TP02",
    terms: "Zahlbar innerhalb von 14 Tagen ohne Abzug",
    iban: "DE89370400440532013000",
    accountName: "Hotel Isartor Betriebs GmbH",
    bic: "COBADEFFXXX",
    remittanceInformation: number,
  };
}

function romeRestaurantSeller(): Party {
  return {
    name: "Trattoria del Colosseo S.r.l.",
    tradeName: "Trattoria del Colosseo",
    vatId: "IT02345678901",
    taxId: "02345678901",
    legalRegId: "02345678901",
    legalRegScheme: "0211",
    electronicAddress: { scheme: "0211", id: "02345678901" },
    address: {
      street: "Via dei Fori Imperiali",
      number: "22",
      city: "Roma",
      postCode: "00184",
      region: "RM",
      country: "IT",
    },
    contact: {
      name: "Amministrazione",
      phone: "+39065550188",
      email: "amministrazione@trattoriadelcolosseo.example",
    },
    it: {
      regimeFiscale: "RF01",
      rea: {
        office: "RM",
        number: "1456789",
        capital: "20000.00",
        soleShareholder: "SM",
        liquidation: "LN",
      },
    },
  };
}

function romeRestaurantPayment(number: string): Payment {
  return {
    meansCode: "30",
    meansText: "Bonifico bancario",
    italianMeansCode: "MP05",
    conditions: "TP02",
    terms: "Pagamento a 30 giorni data fattura",
    iban: "IT41W8000000292100645211151",
    accountName: "Trattoria del Colosseo S.r.l.",
    bic: "BCITITMMXXX",
    remittanceInformation: number,
  };
}

function romeRestaurantBuyer(): Buyer {
  return {
    name: "Studio Legale Ferrari e Associati S.t.p.",
    vatId: "IT03456789012",
    taxId: "03456789012",
    legalRegId: "03456789012",
    legalRegScheme: "0211",
    electronicAddress: { scheme: "0211", id: "03456789012" },
    address: {
      street: "Via Nomentana",
      number: "108",
      city: "Roma",
      postCode: "00161",
      region: "RM",
      country: "IT",
    },
    channel: { kind: "SDI", codiceDestinatario: "M5UXCR1" },
  };
}

function germanHotelB2bZugferd(): Invoice {
  const number = "DE-MUC-2026-004182";
  return {
    format: "cii",
    number,
    issueDate: ISSUE_DATE,
    dueDate: MUNICH_DUE_DATE,
    typeCode: "380",
    currency: "EUR",
    note: "Geschaeftsreise Frau Mustermann, Anreise 24.08.2026, Abreise 27.08.2026",
    references: {
      buyerReference: "KST-4711-MUSTERMANN",
      purchaseOrder: "BT-2026-00918",
      invoicedObject: "FOLIO-2026-004182",
      contract: "RAHMEN-2026-0031",
      project: "PRJ-DE-2026-7",
    },
    // BG-15 is the place of supply, which for accommodation is the hotel itself.
    uapi: {
      buyerAccountingRef: "KST-4711",
      buyer: { buyerId: "0088:4012345000009", origin: "NATIONAL" },
      delivery: {
        name: "Hotel Isartor Muenchen",
        address: {
          street: "Zweibrueckenstrasse",
          number: "8",
          city: "Muenchen",
          postCode: "80331",
          region: "BY",
          country: "DE",
        },
      },
    },
    seller: munichHotelSeller(),
    buyer: {
      name: "Bayern Technik AG",
      vatId: "DE812345678",
      legalRegId: "HRB 98765",
      electronicAddress: { scheme: "EM", id: "rechnungseingang@bayern-technik.example" },
      address: {
        street: "Nordring",
        number: "44",
        city: "Nuernberg",
        postCode: "90409",
        region: "Bayern",
        country: "DE",
      },
      contact: { name: "Reisekostenstelle", email: "reisekosten@bayern-technik.example" },
      channel: {
        kind: "EMAIL",
        email: "rechnungseingang@bayern-technik.example",
        format: "ZUGFERD_V2",
      },
    },
    lines: [
      {
        id: "1",
        name: "Uebernachtung Doppelzimmer zur Einzelnutzung",
        description: "3 Naechte, 24.08.2026 bis 27.08.2026",
        quantity: "3.00",
        unitCode: "DAY",
        unitPriceNet: "145.00",
        netAmount: "435.00",
        vat: { category: "S", rate: "7.00" },
      },
      {
        id: "2",
        name: "Bewirtung Restaurant Isartor",
        description: "Geschaeftsessen mit 4 Personen am 25.08.2026",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "268.00",
        netAmount: "268.00",
        vat: { category: "S", rate: "19.00" },
      },
    ],
    vatBreakdown: [
      {
        category: "S",
        rate: "7.00",
        taxableAmount: "435.00",
        taxAmount: "30.45",
      },
      {
        category: "S",
        rate: "19.00",
        taxableAmount: "268.00",
        taxAmount: "50.92",
      },
    ],
    payment: munichHotelPayment(number),
    totals: {
      lineExtension: "703.00",
      taxExclusive: "703.00",
      taxAmount: "81.37",
      taxInclusive: "784.37",
      payable: "784.37",
    },
  };
}

function germanHotelB2gXrechnung(): Invoice {
  const number = "DE-MUC-2026-004199";
  const leitwegId = "991-01234-56";
  const departureDate = "2026-08-26";
  return {
    format: "xrechnung",
    number,
    issueDate: ISSUE_DATE,
    dueDate: DUE_DATE,
    typeCode: "380",
    currency: "EUR",
    note: "Dienstreise Herr Schneider, Anreise 24.08.2026, Abreise 26.08.2026",
    references: {
      buyerReference: leitwegId,
      purchaseOrder: "BST-2026-004417",
      invoicedObject: "DRG-2026-10442",
    },
    seller: munichHotelSeller(),
    buyer: {
      name: "Bundesamt fuer Musterverwaltung",
      legalRegId: leitwegId,
      legalRegScheme: "0204",
      electronicAddress: { scheme: "0204", id: leitwegId },
      address: {
        street: "Musterallee",
        number: "12",
        city: "Bonn",
        postCode: "53113",
        region: "Nordrhein-Westfalen",
        country: "DE",
      },
      contact: { name: "Referat Z 3 - Reisekosten", email: "rechnung@bamv.bund.example" },
      channel: { kind: "PEPPOL", participantId: `0204:${leitwegId}` },
    },
    // BT-72: check-out ends the stay, so it is the date the service was completed. XRechnung
    // BR-DE-TMP-32 wants BT-72, BG-14 or a line period on every invoice.
    delivery: { date: departureDate },
    lines: [
      {
        id: "1",
        name: "Uebernachtung Einzelzimmer",
        description: "2 Naechte, 24.08.2026 bis 26.08.2026",
        quantity: "2.00",
        unitCode: "DAY",
        unitPriceNet: "129.00",
        netAmount: "258.00",
        vat: { category: "S", rate: "7.00" },
      },
      {
        id: "2",
        name: "Fruehstuecksbuffet",
        quantity: "2.00",
        unitCode: "C62",
        unitPriceNet: "18.00",
        netAmount: "36.00",
        vat: { category: "S", rate: "19.00" },
      },
    ],
    vatBreakdown: [
      {
        category: "S",
        rate: "7.00",
        taxableAmount: "258.00",
        taxAmount: "18.06",
      },
      { category: "S", rate: "19.00", taxableAmount: "36.00", taxAmount: "6.84" },
    ],
    payment: {
      ...munichHotelPayment(number),
      terms: "Zahlbar innerhalb von 30 Tagen ohne Abzug",
    },
    totals: {
      lineExtension: "294.00",
      taxExclusive: "294.00",
      taxAmount: "24.90",
      taxInclusive: "318.90",
      payable: "318.90",
    },
  };
}

function italianRestaurantB2bFattura(): Invoice {
  return {
    format: "fatturapa",
    number: ROME_INVOICE_NUMBER,
    issueDate: ROME_INVOICE_DATE,
    dueDate: ROME_INVOICE_DUE_DATE,
    typeCode: "380",
    currency: "EUR",
    note: "Pranzo di lavoro del 24/08/2026 - sala Traiano",
    references: { purchaseOrder: "ORD-SLF-2026-0091", invoicedObject: "TAV12-CONTO-00451" },
    it: { bollo: { virtuale: "SI", amount: "2.00" } },
    seller: romeRestaurantSeller(),
    buyer: romeRestaurantBuyer(),
    lines: [
      {
        id: "1",
        name: "Pranzo di lavoro - menu completo",
        description: "8 coperti, sala Traiano",
        quantity: "8.00",
        unitCode: "C62",
        unitPriceNet: "34.00",
        netAmount: "272.00",
        vat: { category: "S", rate: "10.00" },
      },
      {
        id: "2",
        name: "Bevande analcoliche",
        quantity: "8.00",
        unitCode: "C62",
        unitPriceNet: "4.50",
        netAmount: "36.00",
        vat: { category: "S", rate: "10.00" },
      },
      {
        id: "3",
        name: "Anticipazioni in nome e per conto - noleggio sala esterna",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "120.00",
        netAmount: "120.00",
        vat: { category: "E", rate: "0.00", natura: "N1" },
      },
    ],
    vatBreakdown: [
      {
        category: "S",
        rate: "10.00",
        taxableAmount: "308.00",
        taxAmount: "30.80",
        esigibilita: "I",
      },
      {
        category: "E",
        rate: "0.00",
        taxableAmount: "120.00",
        taxAmount: "0.00",
        natura: "N1",
        reason: ART15_REASON,
        esigibilita: "I",
      },
    ],
    payment: romeRestaurantPayment(ROME_INVOICE_NUMBER),
    totals: {
      lineExtension: "428.00",
      taxExclusive: "428.00",
      taxAmount: "30.80",
      taxInclusive: "458.80",
      payable: "458.80",
    },
  };
}

function italianRestaurantB2gFpa12(): Invoice {
  const number = "IT-RM-2026-0121";
  return {
    format: "fatturapa",
    number,
    issueDate: ISSUE_DATE,
    dueDate: DUE_DATE,
    typeCode: "380",
    currency: "EUR",
    note: "Servizio di catering per l'evento istituzionale del 20/09/2026",
    references: {
      purchaseOrder: "ODA-2026-000517",
      contract: "CTR-MIC-2026-0088",
      tenderOrLot: "CONV-MIC-2026-0042",
    },
    it: { cup: "J51B26000120001", cig: "B12C3D4E5F" },
    seller: romeRestaurantSeller(),
    buyer: {
      name: "Ministero della Cultura - Direzione Generale Musei",
      taxId: "97564530580",
      address: {
        street: "Via del Collegio Romano",
        number: "27",
        city: "Roma",
        postCode: "00186",
        region: "RM",
        country: "IT",
      },
      channel: { kind: "SDI", codiceDestinatario: "UFY9K3" },
    },
    lines: [
      {
        id: "1",
        name: "Servizio di catering - buffet",
        description: "120 coperti, allestimento e servizio in loco",
        quantity: "120.00",
        unitCode: "C62",
        unitPriceNet: "18.50",
        netAmount: "2220.00",
        vat: { category: "S", rate: "10.00" },
      },
      {
        id: "2",
        name: "Noleggio attrezzature e allestimento sala",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "640.00",
        netAmount: "640.00",
        vat: { category: "S", rate: "22.00" },
      },
    ],
    vatBreakdown: [
      {
        category: "S",
        rate: "10.00",
        taxableAmount: "2220.00",
        taxAmount: "222.00",
        esigibilita: "D",
      },
      {
        category: "S",
        rate: "22.00",
        taxableAmount: "640.00",
        taxAmount: "140.80",
        esigibilita: "D",
      },
    ],
    payment: romeRestaurantPayment(number),
    totals: {
      lineExtension: "2860.00",
      taxExclusive: "2860.00",
      taxAmount: "362.80",
      taxInclusive: "3222.80",
      payable: "3222.80",
    },
  };
}

function italianRestaurantTd04Credit(): Invoice {
  const number = "IT-RM-2026-0128-NC";
  return {
    format: "fatturapa",
    number,
    issueDate: ISSUE_DATE,
    typeCode: "381",
    currency: "EUR",
    note: `Nota di credito a storno parziale della fattura ${ROME_INVOICE_NUMBER}`,
    references: {
      purchaseOrder: "ORD-SLF-2026-0091",
      precedingInvoice: { number: ROME_INVOICE_NUMBER, issueDate: ROME_INVOICE_DATE },
    },
    seller: romeRestaurantSeller(),
    buyer: romeRestaurantBuyer(),
    lines: [
      {
        id: "1",
        name: "Storno pranzo di lavoro - 2 coperti non consumati",
        quantity: "2.00",
        unitCode: "C62",
        unitPriceNet: "34.00",
        netAmount: "68.00",
        vat: { category: "S", rate: "10.00" },
      },
      {
        id: "2",
        name: "Storno bevande analcoliche - 2 coperti",
        quantity: "2.00",
        unitCode: "C62",
        unitPriceNet: "4.50",
        netAmount: "9.00",
        vat: { category: "S", rate: "10.00" },
      },
    ],
    vatBreakdown: [
      { category: "S", rate: "10.00", taxableAmount: "77.00", taxAmount: "7.70", esigibilita: "I" },
    ],
    payment: {
      ...romeRestaurantPayment(number),
      terms: "Importo a credito da compensare sulla prossima fattura",
    },
    totals: {
      lineExtension: "77.00",
      taxExclusive: "77.00",
      taxAmount: "7.70",
      taxInclusive: "84.70",
      payable: "84.70",
    },
  };
}

// PEPPOL-COMMON-R043 runs the KBO/BCE mod-97 rule over every ICD 0208 identifier: the last two
// digits must be 97 - (the first eight mod 97). 0888888895 satisfies it; 0888888896 does not.
const BROKEN_KBO_NUMBER = "0888888896";

function belgianPeppolBroken(): Invoice {
  const base = belgianPeppol();
  const number = "BE-INV-2026-0011";
  return {
    ...base,
    number,
    references: { buyerReference: "BR-2026-91", purchaseOrder: "PO-BE-2026-021" },
    buyer: {
      ...base.buyer,
      vatId: `BE${BROKEN_KBO_NUMBER}`,
      legalRegId: BROKEN_KBO_NUMBER,
      electronicAddress: { scheme: "0208", id: BROKEN_KBO_NUMBER },
      channel: { kind: "PEPPOL", participantId: `0208:${BROKEN_KBO_NUMBER}` },
    },
    payment: { ...base.payment, remittanceInformation: number },
  };
}

function germanHotelB2gBroken(): Invoice {
  const base = germanHotelB2gXrechnung();
  const number = "DE-MUC-2026-004203";
  return {
    ...base,
    number,
    note: "Dienstreise Frau Weber, Anreise 25.08.2026, Abreise 27.08.2026",
    // BR-DE-15: BT-10 must carry the Leitweg-ID. Dropping it leaves the invoice a valid EN 16931
    // document that no German authority can route, which is the whole point of the CIUS.
    references: { purchaseOrder: "BST-2026-004489", invoicedObject: "DRG-2026-10488" },
    // BR-DE-6: BT-42 is mandatory in XRechnung and optional in EN 16931.
    seller: {
      ...munichHotelSeller(),
      contact: { name: "Rechnungswesen", email: "rechnung@hotel-isartor.example" },
    },
    payment: { ...base.payment, remittanceInformation: number },
  };
}

const ROME_B2C_INVOICE_DATE = "2026-08-25";

function italianRestaurantB2cPec(): Invoice {
  const number = "IT-RM-2026-0133";
  return {
    format: "fatturapa",
    number,
    issueDate: ROME_B2C_INVOICE_DATE,
    // Paid at the table, so BT-9 is the invoice date itself rather than a credit period.
    dueDate: ROME_B2C_INVOICE_DATE,
    typeCode: "380",
    currency: "EUR",
    note: "Cena del 25/08/2026 - tavolo 7",
    references: { invoicedObject: "TAV07-CONTO-00518" },
    seller: romeRestaurantSeller(),
    buyer: {
      // BT-44 keeps the whole name; FatturaPA splits it into Nome + Cognome through `person`.
      name: "Giulia Bianchi",
      person: { forename: "Giulia", surname: "Bianchi", gender: "FEMALE" },
      // A private individual has no partita IVA: CodiceFiscale stands alone (SDI check 00417).
      taxId: "BNCGLI85E41H501P",
      address: {
        street: "Via dei Serpenti",
        number: "42",
        city: "Roma",
        postCode: "00184",
        region: "RM",
        country: "IT",
      },
      // No SDI inbox, so the file goes to the buyer's PEC and is also made available in her
      // reserved area on the Agenzia delle Entrate portal.
      channel: {
        kind: "SDI",
        codiceDestinatario: "0000000",
        pec: "giulia.bianchi@pec.example.it",
      },
    },
    lines: [
      {
        id: "1",
        name: "Cena alla carta - menu di pesce",
        description: "2 coperti, sala Traiano",
        quantity: "2.00",
        unitCode: "C62",
        unitPriceNet: "42.00",
        netAmount: "84.00",
        vat: { category: "S", rate: "10.00" },
      },
      {
        id: "2",
        name: "Vino bianco fermo - bottiglia 0,75 l",
        quantity: "1.00",
        unitCode: "C62",
        unitPriceNet: "18.00",
        netAmount: "18.00",
        vat: { category: "S", rate: "10.00" },
      },
      {
        id: "3",
        name: "Coperto",
        quantity: "2.00",
        unitCode: "C62",
        unitPriceNet: "3.00",
        netAmount: "6.00",
        vat: { category: "S", rate: "10.00" },
      },
    ],
    // Somministrazione di alimenti e bevande: 10% on the whole bill, wine included.
    vatBreakdown: [
      {
        category: "S",
        rate: "10.00",
        taxableAmount: "108.00",
        taxAmount: "10.80",
        esigibilita: "I",
      },
    ],
    payment: {
      meansCode: "48",
      meansText: "Carta di pagamento",
      italianMeansCode: "MP08",
      conditions: "TP02",
      terms: "Pagamento contestuale con carta di credito al tavolo",
      remittanceInformation: number,
    },
    totals: {
      lineExtension: "108.00",
      taxExclusive: "108.00",
      taxAmount: "10.80",
      taxInclusive: "118.80",
      payable: "118.80",
    },
  };
}

const BUILDERS: Record<PresetId, () => Invoice> = {
  "it-b2b-sdi": italianB2bSdi,
  "be-peppol": belgianPeppol,
  broken,
  "be-peppol-broken": belgianPeppolBroken,
  "de-hotel-b2b-zugferd": germanHotelB2bZugferd,
  "de-hotel-b2g-xrechnung": germanHotelB2gXrechnung,
  "de-hotel-b2g-broken": germanHotelB2gBroken,
  "it-restaurant-b2c-pec": italianRestaurantB2cPec,
  "it-restaurant-b2b-fattura": italianRestaurantB2bFattura,
  "it-restaurant-b2g-fpa12": italianRestaurantB2gFpa12,
  "it-restaurant-td04-credit": italianRestaurantTd04Credit,
};

export function preset(id: PresetId): Invoice {
  const build = BUILDERS[id];
  if (!build) throw new Error(`presets: unknown preset "${id}"`);
  return build();
}
