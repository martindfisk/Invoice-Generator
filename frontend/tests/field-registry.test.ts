import { describe, expect, it } from "vitest";
import catalog from "../src/bt-catalog.json";
import {
  allFields,
  catalogEntry,
  formatCarries,
  genericField,
  invoiceGroups,
  resolveField,
  rowCount,
  type GroupSpec,
} from "../src/field-registry";
import { FORMAT_IDS, getFormat } from "../src/formats";
import type { Channel, FieldId, Invoice } from "../src/model";
import { getField } from "../src/model";
import { PRESET_IDS, preset } from "../src/presets";

type CatalogEntry = {
  id: string;
  group: string;
  name: string;
  description: string;
  cardinality: string;
  datatype: string;
};

const CATALOG = catalog as CatalogEntry[];

// Deep-required view of a type: every optional property becomes mandatory, recursively, and
// unions (Channel) distribute so each variant has to be spelled out in full. This is what makes
// the coverage test bite - a new field on any model type stops FULL_INVOICE from type checking
// (`npm run typecheck`, `npm run build`) before the assertions below even run.
type Complete<T> = T extends (infer E)[]
  ? Complete<E>[]
  : T extends object
    ? { [K in keyof T]-?: Complete<NonNullable<T[K]>> }
    : T;

const CHANNELS: Complete<Channel>[] = [
  { kind: "SDI", codiceDestinatario: "ABC1234", pec: "fatture@pec.example.it" },
  { kind: "PEPPOL", participantId: "0208:0888888895" },
  { kind: "EMAIL", email: "ap@example.com", format: "ZUGFERD_V2" },
];

const FULL_INVOICE: Complete<Invoice> = {
  format: "fatturapa",
  number: "2026-000123",
  issueDate: "2026-03-02",
  dueDate: "2026-04-01",
  typeCode: "380",
  currency: "EUR",
  note: "Consegna presso la sede di Milano.",
  references: {
    buyerReference: "04011000-12345-67",
    project: "PRJ-2026-08",
    contract: "CTR-2026-114",
    purchaseOrder: "PO-88231",
    salesOrder: "SO-4412",
    despatchAdvice: { number: "DDT-2026-77", issueDate: "2026-02-27" },
    tenderOrLot: "CONSIP-2025-LOT3",
    invoicedObject: "SUB-99120",
    precedingInvoice: { number: "2026-000090", issueDate: "2026-01-31" },
  },
  it: {
    bollo: { virtuale: "SI", amount: "2.00" },
    cup: "J51B21000320001",
    cig: "9876543ABC",
  },
  seller: {
    name: "Officina Meccanica Rossi S.r.l.",
    tradeName: "Rossi Service",
    person: { forename: "Giulia", surname: "Rossi", gender: "FEMALE" },
    vatId: "IT01234567890",
    taxId: "01234567890",
    legalRegId: "MI-1234567",
    legalRegScheme: "0211",
    electronicAddress: { scheme: "0211", id: "IT01234567890" },
    address: {
      street: "Via Giuseppe Verdi",
      number: "12",
      city: "Milano",
      postCode: "20121",
      region: "MI",
      country: "IT",
    },
    contact: { name: "Giulia Rossi", phone: "+39 02 1234567", email: "fatture@rossi.example.it" },
    it: {
      regimeFiscale: "RF01",
      rea: {
        office: "MI",
        number: "1234567",
        capital: "50000.00",
        soleShareholder: "SU",
        liquidation: "LN",
      },
    },
  },
  buyer: {
    name: "Ministero della Cultura",
    tradeName: "MiC",
    person: { forename: "Mario", surname: "Bianchi", gender: "MALE" },
    vatId: "IT97904380587",
    taxId: "97904380587",
    legalRegId: "RM-7654321",
    legalRegScheme: "0211",
    electronicAddress: { scheme: "0201", id: "UFY9K3" },
    address: {
      street: "Via del Collegio Romano",
      number: "27",
      city: "Roma",
      postCode: "00186",
      region: "RM",
      country: "IT",
    },
    contact: { name: "Ufficio Acquisti", phone: "+39 06 67231", email: "acquisti@cultura.gov.it" },
    it: {
      regimeFiscale: "RF01",
      rea: {
        office: "RM",
        number: "7654321",
        capital: "0.00",
        soleShareholder: "SM",
        liquidation: "LN",
      },
    },
    channel: CHANNELS[0],
  },
  delivery: { date: "2026-02-27" },
  lines: [
    {
      id: "1",
      name: "Manutenzione impianto",
      description: "Intervento programmato, 4 ore in sede.",
      quantity: "4.00",
      unitCode: "HUR",
      unitPriceNet: "85.00",
      netAmount: "340.00",
      vat: { category: "S", rate: "22.00", natura: "", vatexCode: "", reason: "" },
      it: {
        altriDatiGestionali: {
          tipoDato: "INTERVENTO",
          riferimentoTesto: "Contratto quadro 2026",
          riferimentoNumero: "114",
          riferimentoData: "2026-01-15",
        },
      },
      uapi: {
        allowance: "10.00",
        surcharge: "0.00",
        itemNumber: "MAN-IMP-04",
        itemCode: "65112200",
        purpose: "STANDARD",
        regulatory: "DPR 633/1972 art. 3",
        label: "Manutenzione programmata",
      },
    },
    {
      id: "2",
      name: "Ricambi",
      description: "Guarnizioni serie B.",
      quantity: "10.00",
      unitCode: "C62",
      unitPriceNet: "6.00",
      netAmount: "60.00",
      vat: {
        category: "AE",
        rate: "0.00",
        natura: "N6.9",
        vatexCode: "VATEX-EU-AE",
        reason: "Inversione contabile art. 17 c. 6 DPR 633/1972",
      },
      it: {
        altriDatiGestionali: {
          tipoDato: "INTENTO",
          riferimentoTesto: "Dichiarazione d'intento",
          riferimentoNumero: "7",
          riferimentoData: "2026-01-08",
        },
      },
      uapi: {
        allowance: "0.00",
        surcharge: "2.50",
        itemNumber: "GRN-B-10",
        itemCode: "40169300",
        purpose: "GIFT",
        regulatory: "Reverse charge art. 17 c. 6",
        label: "Guarnizioni serie B",
      },
    },
  ],
  vatBreakdown: [
    {
      category: "S",
      rate: "22.00",
      taxableAmount: "340.00",
      taxAmount: "74.80",
      natura: "",
      vatexCode: "",
      reason: "",
      esigibilita: "S",
    },
    {
      category: "AE",
      rate: "0.00",
      taxableAmount: "60.00",
      taxAmount: "0.00",
      natura: "N6.9",
      vatexCode: "VATEX-EU-AE",
      reason: "Inversione contabile art. 17 c. 6 DPR 633/1972",
      esigibilita: "I",
    },
  ],
  payment: {
    meansCode: "30",
    meansText: "Bonifico bancario",
    italianMeansCode: "MP05",
    conditions: "TP02",
    terms: "Pagamento a 30 giorni data fattura.",
    iban: "IT60X0542811101000000123456",
    accountName: "Officina Meccanica Rossi S.r.l.",
    bic: "BLOPIT22",
    remittanceInformation: "2026-000123",
  },
  totals: {
    lineExtension: "400.00",
    allowance: "0.00",
    charge: "0.00",
    taxExclusive: "400.00",
    taxAmount: "74.80",
    taxInclusive: "474.80",
    prepaid: "0.00",
    rounding: "0.00",
    payable: "474.80",
  },
  uapi: {
    series: "FT",
    activityCode: "43.22.01",
    operationDate: "2026-03-01",
    buyerAccountingRef: "COSTCENTER1",
    buyer: { buyerId: "0211:09876543210", origin: "NATIONAL" },
    delivery: {
      name: "Magazzino Milano",
      address: {
        street: "Via Industriale",
        number: "99",
        city: "Milano",
        postCode: "20157",
        region: "MI",
        country: "IT",
      },
    },
  },
};

// Model leaves that are deliberately absent from the registry, with the reason each one is not a
// business field the Compose step should show.
const EXCLUDED: Record<string, string> = {
  format:
    "Discriminator, not a business term: it selects which syntax the invoice is serialised to " +
    "(the format switch in the workbench), and nothing in it is written into the document.",
  "buyer.channel.kind":
    "Discriminator of the Channel union: choosing it swaps which routing fields exist " +
    "(codiceDestinatario/pec vs participantId vs email/format) rather than carrying a value.",
  "buyer.it.regimeFiscale":
    "FatturaPA has no RegimeFiscale for the CessionarioCommittente - it exists only under " +
    "1.2.1.8 for the cedente prestatore. The path exists only because Buyer reuses the Party " +
    "type; no writer or rule reads buyer.it.",
  "buyer.it.rea.office":
    "IscrizioneREA (1.2.4) is a CedentePrestatore-only block in FatturaPA 1.9.1; reachable on " +
    "the buyer only because Buyer reuses the Party type.",
  "buyer.it.rea.number": "Same as buyer.it.rea.office - IscrizioneREA is seller-only.",
  "buyer.it.rea.capital": "Same as buyer.it.rea.office - IscrizioneREA is seller-only.",
  "buyer.it.rea.soleShareholder": "Same as buyer.it.rea.office - IscrizioneREA is seller-only.",
  "buyer.it.rea.liquidation": "Same as buyer.it.rea.office - IscrizioneREA is seller-only.",
  "uapi.series":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: UAPI document.series has no EN 16931 business term at all.",
  "uapi.activityCode":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: UAPI document.activity_code is a platform code list, not a BT.",
  "uapi.operationDate":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: UAPI document.operation_date is the VAT point date fiskaly derives.",
  "uapi.buyerAccountingRef":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BT-19 maps to document.references.buyer_routing.",
  "uapi.buyer.buyerId":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BT-46 maps to recipients[].buyer_id.",
  "uapi.buyer.origin":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: UAPI recipients[].origin is a platform flag defaulting to NATIONAL.",
  "uapi.delivery.name":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BT-70 maps to recipients[].shipping.name.",
  "uapi.delivery.address.street":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BG-15 maps to recipients[].shipping.address.",
  "uapi.delivery.address.number":
    "Same as uapi.delivery.address.street - part of BG-15 on the operation only.",
  "uapi.delivery.address.city":
    "Same as uapi.delivery.address.street - part of BG-15 on the operation only.",
  "uapi.delivery.address.postCode":
    "Same as uapi.delivery.address.street - part of BG-15 on the operation only.",
  "uapi.delivery.address.region":
    "Same as uapi.delivery.address.street - part of BG-15 on the operation only.",
  "uapi.delivery.address.country":
    "Same as uapi.delivery.address.street - part of BG-15 on the operation only.",
  "lines.{i}.uapi.allowance":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BT-136 maps to entries[].data.value.discount.",
  "lines.{i}.uapi.surcharge":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BT-141 maps to entries[].data.value.surcharge.",
  "lines.{i}.uapi.itemNumber":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BT-155/BT-157 map to entries[].data.product.number.",
  "lines.{i}.uapi.itemCode":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: BT-158 maps to entries[].data.product.code.",
  "lines.{i}.uapi.purpose":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: UAPI entries[].details.purpose is a platform flag (STANDARD or GIFT).",
  "lines.{i}.uapi.regulatory":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: UAPI entries[].details.regulatory is free platform text.",
  "lines.{i}.uapi.label":
    "Carried on the fiskaly operation but rendered by no writer here, so it is deliberately absent from the Compose form and discoverable through the spec coverage panel instead: UAPI entries[].details.label is free platform text.",
};

// BTs whose catalog group is a child group of the group they are declared in. EN 16931 nests
// price (BG-29), line VAT (BG-30) and item (BG-31) under the invoice line; the registry renders
// one row per line, so those leaves live directly in BG-25's field list.
const FLATTENED: Record<string, string> = {
  "BT-146": "BG-29 PRICE DETAILS rendered inside the BG-25 line row",
  "BT-151": "BG-30 LINE VAT INFORMATION rendered inside the BG-25 line row",
  "BT-152": "BG-30 LINE VAT INFORMATION rendered inside the BG-25 line row",
  "BT-153": "BG-31 ITEM INFORMATION rendered inside the BG-25 line row",
  "BT-154": "BG-31 ITEM INFORMATION rendered inside the BG-25 line row",
};

function leaves(value: unknown, prefix: string, out: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leaves(item, `${prefix}.${index}`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  out.add(prefix);
}

function modelLeaves(invoice: Invoice): string[] {
  const out = new Set<string>();
  leaves(invoice, "", out);
  return [...out].map(genericField).sort();
}

const MODEL_LEAVES = new Set([
  ...modelLeaves(FULL_INVOICE as Invoice),
  ...CHANNELS.flatMap((channel) => {
    const out = new Set<string>();
    leaves(channel, "buyer.channel", out);
    return [...out];
  }),
]);

function flatGroups(groups: GroupSpec[] = invoiceGroups()): GroupSpec[] {
  return groups.flatMap((group) => [group, ...flatGroups(group.subgroups ?? [])]);
}

function groupOf(field: FieldId): GroupSpec {
  const group = flatGroups().find((candidate) =>
    candidate.fields.some((spec) => spec.field === field),
  );
  if (!group) throw new Error(`field-registry.test: no group holds "${field}"`);
  return group;
}

const REGISTRY_FIELDS = allFields().map((spec) => spec.field);
const REGISTRY_SET = new Set(REGISTRY_FIELDS);

function ancestors(group: string): string[] {
  const out: string[] = [];
  let current = CATALOG.find((entry) => entry.id === group);
  while (current && current.group !== current.id) {
    out.push(current.group);
    const parent: CatalogEntry | undefined = CATALOG.find((entry) => entry.id === current!.group);
    current = parent;
  }
  return out;
}

function mappedFields(formatId: (typeof FORMAT_IDS)[number]): string[] {
  return [
    ...new Set(
      getFormat(formatId)
        .map.map((row) => row.field)
        .filter(Boolean),
    ),
  ].sort();
}

describe("model coverage", () => {
  it("registers every leaf a fully populated invoice can hold", () => {
    const missing = [...MODEL_LEAVES]
      .filter((leaf) => !REGISTRY_SET.has(leaf))
      .filter((leaf) => !(leaf in EXCLUDED))
      .sort();
    expect(missing).toEqual([]);
  });

  it("registers nothing the model cannot hold", () => {
    const unknown = REGISTRY_FIELDS.filter((field) => !MODEL_LEAVES.has(field)).sort();
    expect(unknown).toEqual([]);
  });

  it("keeps the exclusion list live and disjoint from the registry", () => {
    const stale = Object.keys(EXCLUDED).filter((leaf) => !MODEL_LEAVES.has(leaf));
    expect(stale).toEqual([]);
    const contradictory = Object.keys(EXCLUDED).filter((leaf) => REGISTRY_SET.has(leaf));
    expect(contradictory).toEqual([]);
    for (const reason of Object.values(EXCLUDED)) expect(reason.length).toBeGreaterThan(40);
  });

  it("covers every leaf the presets populate", () => {
    const fromPresets = new Set(PRESET_IDS.flatMap((id) => modelLeaves(preset(id))));
    const missing = [...fromPresets]
      .filter((leaf) => !REGISTRY_SET.has(leaf) && !(leaf in EXCLUDED))
      .sort();
    expect(missing).toEqual([]);
  });

  it("resolves every registry field against the fully populated invoice", () => {
    const unresolved = REGISTRY_FIELDS.filter((field) => {
      if (field.startsWith("buyer.channel.")) return false; // one variant at a time
      return getField(FULL_INVOICE as Invoice, resolveField(field, 0)) === undefined;
    });
    expect(unresolved).toEqual([]);
  });
});

describe("BT integrity", () => {
  it("cites only BTs that exist in the catalog", () => {
    const unknown = allFields()
      .filter((spec) => spec.bt && !catalogEntry(spec.bt))
      .map((spec) => `${spec.field} -> ${spec.bt}`);
    expect(unknown).toEqual([]);
  });

  it("claims no BT twice", () => {
    const claims = new Map<string, string[]>();
    for (const spec of allFields()) {
      if (!spec.bt) continue;
      claims.set(spec.bt, [...(claims.get(spec.bt) ?? []), spec.field]);
    }
    const duplicated = [...claims.entries()]
      .filter(([, fields]) => fields.length > 1)
      .map(([bt, fields]) => `${bt}: ${fields.join(", ")}`);
    expect(duplicated).toEqual([]);
  });

  it("declares each BT in the business group the catalog gives it", () => {
    const mismatches: string[] = [];
    for (const spec of allFields()) {
      if (!spec.bt) continue;
      const entry = catalogEntry(spec.bt);
      if (!entry) continue;
      const declared = groupOf(spec.field).bg;
      if (entry.group === declared) continue;
      if (FLATTENED[spec.bt] && ancestors(entry.group).includes(declared)) continue;
      mismatches.push(
        `${spec.field} (${spec.bt}) declared in ${declared}, catalog says ${entry.group}`,
      );
    }
    expect(mismatches).toEqual([]);
  });

  it("flattens only the documented line subgroups", () => {
    const flattened = allFields()
      .filter((spec) => spec.bt && catalogEntry(spec.bt)?.group !== groupOf(spec.field).bg)
      .map((spec) => spec.bt as string)
      .sort();
    expect(flattened).toEqual(Object.keys(FLATTENED).sort());
  });

  it("labels every group that is not an EN 16931 business group", () => {
    const nonEn = flatGroups()
      .filter((group) => !catalogEntry(group.bg))
      .map((group) => group.bg)
      .sort();
    expect(nonEn).toEqual(["CHANNEL", "FPA", "FPA-BUYER", "FPA-PAYMENT", "FPA-SELLER"]);
    for (const group of flatGroups()) {
      if (catalogEntry(group.bg)) continue;
      // Nothing in a non-EN group may claim an EN business term.
      expect(group.fields.filter((spec) => spec.bt)).toEqual([]);
    }
  });

  it("gives every group a title and a cardinality", () => {
    for (const group of flatGroups()) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.cardinality).toMatch(/^\d\.\.[\dn]$/);
      expect(group.fields.length).toBeGreaterThan(0);
    }
  });
});

describe("registry shape", () => {
  it("has no duplicate field ids", () => {
    const seen = new Set<string>();
    const duplicated = REGISTRY_FIELDS.filter((field) => {
      if (seen.has(field)) return true;
      seen.add(field);
      return false;
    });
    expect(duplicated).toEqual([]);
  });

  it("gives every field a label, a kind and usable code values", () => {
    for (const spec of allFields()) {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(["text", "longtext", "decimal", "date", "code"]).toContain(spec.kind);
      if (!spec.codeValues) continue;
      expect(spec.kind).toBe("code");
      expect(spec.codeValues.length).toBeGreaterThan(0);
      expect(new Set(spec.codeValues).size).toBe(spec.codeValues.length);
    }
  });

  it("explains every field the model carries without an EN 16931 term", () => {
    const unexplained = allFields()
      .filter((spec) => !spec.bt && !spec.hint)
      .map((spec) => spec.field);
    expect(unexplained).toEqual([]);
  });

  it("closes the code lists the standards close", () => {
    const values = (field: string) =>
      allFields().find((spec) => spec.field === field)?.codeValues ?? [];
    expect(values("typeCode")).toEqual(["380", "381"]);
    expect(values("vatBreakdown.{i}.category")).toEqual(["S", "Z", "E", "AE", "K", "G", "O"]);
    expect(values("lines.{i}.vat.category")).toEqual(values("vatBreakdown.{i}.category"));
    expect(values("payment.conditions")).toEqual(["TP01", "TP02", "TP03"]);
    expect(values("vatBreakdown.{i}.esigibilita")).toEqual(["I", "D", "S"]);
    expect(values("payment.italianMeansCode")).toHaveLength(23);
    expect(values("payment.italianMeansCode")[22]).toBe("MP23");
    expect(values("seller.it.regimeFiscale")).toHaveLength(19);
    expect(values("seller.it.regimeFiscale")).not.toContain("RF03");
    expect(values("vatBreakdown.{i}.natura")).toEqual(values("lines.{i}.vat.natura"));
    expect(values("vatBreakdown.{i}.natura")).toHaveLength(21);
    expect(values("lines.{i}.unitCode")).toEqual([
      "C62",
      "H87",
      "DAY",
      "HUR",
      "KGM",
      "LTR",
      "MTR",
      "MTQ",
      "MTK",
    ]);
  });
});

describe("format coverage", () => {
  it("maps nothing the registry does not know", () => {
    const unknown: string[] = [];
    for (const formatId of FORMAT_IDS) {
      for (const field of mappedFields(formatId)) {
        if (!REGISTRY_SET.has(field)) unknown.push(`${formatId}: ${field}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("reports how many registry fields each format carries", () => {
    const report = FORMAT_IDS.map((formatId) => {
      const carried = REGISTRY_FIELDS.filter((field) => formatCarries(formatId, field));
      expect(carried.length).toBe(mappedFields(formatId).length);
      return `${formatId.padEnd(10)} ${String(carried.length).padStart(3)}/${REGISTRY_FIELDS.length}`;
    });
    console.info(`registry fields carried per format:\n${report.join("\n")}`);
    expect(report).toHaveLength(4);
  });

  it("answers formatCarries for indexed fields", () => {
    expect(formatCarries("ubl", "lines.2.netAmount")).toBe(true);
    expect(formatCarries("ubl", "lines.{i}.netAmount")).toBe(true);
    expect(formatCarries("xrechnung", "lines.11.vat.rate")).toBe(true);
    expect(formatCarries("cii", "vatBreakdown.3.taxableAmount")).toBe(true);
    expect(formatCarries("fatturapa", "lines.0.it.altriDatiGestionali.tipoDato")).toBe(true);
    expect(formatCarries("fatturapa", "vatBreakdown.1.esigibilita")).toBe(true);
    expect(formatCarries("ubl", "vatBreakdown.1.esigibilita")).toBe(false);
    expect(formatCarries("cii", "lines.2.it.altriDatiGestionali.tipoDato")).toBe(false);
    expect(formatCarries("fatturapa", "lines.2.description")).toBe(false);
  });

  it("carries the Italian-only fields in FatturaPA alone", () => {
    const italianOnly = [
      "payment.conditions",
      "payment.italianMeansCode",
      "seller.it.regimeFiscale",
      "seller.it.rea.number",
      "it.cig",
      "it.bollo.amount",
      "vatBreakdown.{i}.natura",
      "vatBreakdown.{i}.esigibilita",
      "buyer.channel.codiceDestinatario",
    ];
    for (const field of italianOnly) {
      expect(REGISTRY_SET.has(field)).toBe(true);
      expect(formatCarries("fatturapa", field)).toBe(true);
      for (const formatId of ["ubl", "xrechnung", "cii"] as const) {
        expect(formatCarries(formatId, field)).toBe(false);
      }
    }
  });

  it("leaves BT-23 and BT-24 to the format, not the registry", () => {
    // Both are constants of the chosen syntax (CustomizationID / ProfileID), written from
    // mapping rows with an empty field id. They are not model fields, and FieldSpec has no
    // read-only marker, so the registry does not list them.
    for (const formatId of ["ubl", "xrechnung"] as const) {
      const constants = getFormat(formatId).map.filter((row) => row.field === "");
      expect(constants.map((row) => row.bt)).toContain("BT-24");
    }
    expect(allFields().filter((spec) => spec.bt === "BT-23" || spec.bt === "BT-24")).toEqual([]);
  });
});

describe("repeatable groups", () => {
  const groups = invoiceGroups();
  const lines = groups.find((group) => group.bg === "BG-25") as GroupSpec;
  const breakdown = groups.find((group) => group.bg === "BG-23") as GroupSpec;

  it("counts the rows of the array it repeats over", () => {
    expect(rowCount(FULL_INVOICE as Invoice, lines)).toBe(2);
    expect(rowCount(FULL_INVOICE as Invoice, breakdown)).toBe(2);
    const single = preset("be-peppol");
    expect(rowCount(single, lines)).toBe(single.lines.length);
    expect(rowCount({ ...single, lines: [] }, lines)).toBe(0);
  });

  it("counts one row for groups that do not repeat", () => {
    for (const group of flatGroups()) {
      if (group.repeatable) continue;
      expect(rowCount(FULL_INVOICE as Invoice, group)).toBe(1);
    }
  });

  it("uses the {i} placeholder in repeatable groups and nowhere else", () => {
    for (const group of flatGroups()) {
      for (const spec of group.fields) {
        if (group.repeatable) {
          expect(spec.field.startsWith(`${group.repeatable.basePath}.{i}.`)).toBe(true);
        } else {
          expect(spec.field).not.toContain("{i}");
        }
      }
    }
  });

  it("resolves a row index into a path the model answers", () => {
    expect(resolveField("lines.{i}.netAmount", 1)).toBe("lines.1.netAmount");
    expect(resolveField("totals.payable", 3)).toBe("totals.payable");
    const invoice = FULL_INVOICE as Invoice;
    for (let index = 0; index < rowCount(invoice, lines); index += 1) {
      for (const spec of lines.fields) {
        expect(getField(invoice, resolveField(spec.field, index))).toBeDefined();
      }
    }
    for (let index = 0; index < rowCount(invoice, breakdown); index += 1) {
      for (const spec of breakdown.fields) {
        expect(getField(invoice, resolveField(spec.field, index))).toBeDefined();
      }
    }
  });

  it("round-trips indexed paths back to their generic form", () => {
    expect(genericField("lines.0.vat.category")).toBe("lines.{i}.vat.category");
    expect(genericField("vatBreakdown.12.taxAmount")).toBe("vatBreakdown.{i}.taxAmount");
    expect(genericField("totals.payable")).toBe("totals.payable");
  });
});
