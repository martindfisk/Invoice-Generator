import catalog from "./bt-catalog.json";
import { getFormat } from "./formats";
import type { FieldId, FormatId, Invoice } from "./model";

export type FieldKind = "text" | "longtext" | "decimal" | "date" | "code";

export type FieldSpec = {
  field: FieldId;
  bt?: string;
  label: string;
  kind: FieldKind;
  codeValues?: readonly string[];
  hint?: string;
};

export type GroupSpec = {
  bg: string;
  title: string;
  cardinality: string;
  fields: FieldSpec[];
  repeatable?: { basePath: string; countPath: keyof Invoice };
  subgroups?: GroupSpec[];
};

type CatalogEntry = {
  id: string;
  group: string;
  name: string;
  description: string;
  cardinality: string;
  datatype: string;
};

const CATALOG = catalog as CatalogEntry[];
const BY_ID = new Map(CATALOG.map((entry) => [entry.id, entry]));

export function catalogEntry(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}

function f(
  field: FieldId,
  bt: string | undefined,
  label: string,
  kind: FieldKind,
  codeValues?: readonly string[],
  hint?: string,
): FieldSpec {
  return {
    field,
    bt,
    label,
    kind,
    codeValues,
    hint: hint ?? (bt ? BY_ID.get(bt)?.description : undefined),
  };
}

function bgCardinality(bg: string, fallback: string): string {
  return BY_ID.get(bg)?.cardinality ?? fallback;
}

function bgTitle(bg: string, fallback: string): string {
  const name = BY_ID.get(bg)?.name;
  return name ? name.charAt(0) + name.slice(1).toLowerCase() : fallback;
}

// UNCL5305 subset carried by the model's VatCategory union. EN 16931 also allows L (IGIC,
// Canary Islands) and M (IPSI, Ceuta/Melilla); the model has no representation for them, so
// they are deliberately not offered as pickable values.
const VAT_CATEGORIES = ["S", "Z", "E", "AE", "K", "G", "O"] as const;

// UNCL1001 subset the model's typeCode union allows.
const DOCUMENT_TYPES = ["380", "381"] as const;

// UN/ECE Rec 20 rev. 17 — the handful of codes these invoices realistically use, not the
// full list (~1800 codes).
const UNIT_CODES = ["C62", "H87", "DAY", "HUR", "KGM", "LTR", "MTR", "MTQ", "MTK"] as const;

// FatturaPA 1.9.1 Natura (only valid with AliquotaIVA 0).
const NATURA = [
  "N1",
  "N2.1",
  "N2.2",
  "N3.1",
  "N3.2",
  "N3.3",
  "N3.4",
  "N3.5",
  "N3.6",
  "N4",
  "N5",
  "N6.1",
  "N6.2",
  "N6.3",
  "N6.4",
  "N6.5",
  "N6.6",
  "N6.7",
  "N6.8",
  "N6.9",
  "N7",
] as const;

// FatturaPA 1.9.1 EsigibilitaIVA: immediata / differita / scissione dei pagamenti.
const ESIGIBILITA = ["I", "D", "S"] as const;

// FatturaPA 1.9.1 CondizioniPagamento.
const CONDIZIONI_PAGAMENTO = ["TP01", "TP02", "TP03"] as const;

// FatturaPA 1.9.1 ModalitaPagamento.
const MODALITA_PAGAMENTO = [
  "MP01",
  "MP02",
  "MP03",
  "MP04",
  "MP05",
  "MP06",
  "MP07",
  "MP08",
  "MP09",
  "MP10",
  "MP11",
  "MP12",
  "MP13",
  "MP14",
  "MP15",
  "MP16",
  "MP17",
  "MP18",
  "MP19",
  "MP20",
  "MP21",
  "MP22",
  "MP23",
] as const;

// FatturaPA 1.9.1 RegimeFiscale. RF03 does not exist in the code list.
const REGIME_FISCALE = [
  "RF01",
  "RF02",
  "RF04",
  "RF05",
  "RF06",
  "RF07",
  "RF08",
  "RF09",
  "RF10",
  "RF11",
  "RF12",
  "RF13",
  "RF14",
  "RF15",
  "RF16",
  "RF17",
  "RF18",
  "RF19",
  "RF20",
] as const;

const SOCIO_UNICO = ["SU", "SM"] as const;

const STATO_LIQUIDAZIONE = ["LS", "LN"] as const;

const BOLLO_VIRTUALE = ["SI"] as const;

const EMAIL_ATTACHMENT_FORMATS = ["ZUGFERD_V2", "XRECHNUNG_V3"] as const;

// fiskaly UAPI 2026-06-01 components.schemas.PersonGender.
const GENDERS = ["MALE", "FEMALE", "DIVERSE"] as const;

const FPA = "FatturaPA 1.9.1";

function party(prefix: "seller" | "buyer", bg: string, addressBg: string, contactBg: string) {
  const at = (leaf: string) => `${prefix}.${leaf}` as FieldId;
  const isSeller = prefix === "seller";
  const fields = [
    f(at("name"), isSeller ? "BT-27" : "BT-44", "Name", "text"),
    f(at("tradeName"), isSeller ? "BT-28" : "BT-45", "Trading name", "text"),
    f(
      at("person.forename"),
      undefined,
      "Forename",
      "text",
      undefined,
      `Set only when this party is a natural person. EN 16931 has no consumer concept — ${
        isSeller ? "BT-27" : "BT-44"
      } stays the single name — but ${FPA} 1.${isSeller ? 2 : 4}.1.3 Anagrafica is a choice of Denominazione or Nome + Cognome, and the fiskaly UAPI splits the recipient into BusinessRecipient and ConsumerRecipient.`,
    ),
    f(
      at("person.surname"),
      undefined,
      "Surname",
      "text",
      undefined,
      `Written with the forename as ${FPA} 1.${
        isSeller ? 2 : 4
      }.1.3.3 Cognome; a party with a surname carries no Denominazione, and an Italian consumer carries CodiceFiscale without IdFiscaleIVA.`,
    ),
    f(
      at("person.gender"),
      undefined,
      "Gender",
      "code",
      GENDERS,
      "Required by the fiskaly UAPI PersonName (2026-06-01) for a CONSUMER recipient; no XML syntax here carries it, so it never reaches FatturaPA, UBL or CII.",
    ),
    f(at("vatId"), isSeller ? "BT-31" : "BT-48", "VAT identifier", "text"),
    // BT-32 is seller-only in EN 16931; the buyer's codice fiscale sits in the FatturaPA group.
    ...(isSeller ? [f("seller.taxId", "BT-32", "Tax registration identifier", "text")] : []),
    f(at("legalRegId"), isSeller ? "BT-30" : "BT-47", "Legal registration identifier", "text"),
    f(
      at("legalRegScheme"),
      undefined,
      "Legal registration scheme",
      "code",
      undefined,
      `Scheme identifier of the legal registration id (EN 16931 attribute ${
        isSeller ? "BT-30-1" : "BT-47-1"
      }, ISO 6523 ICD) — an attribute of the identifier, not a business term of its own.`,
    ),
    f(at("electronicAddress.id"), isSeller ? "BT-34" : "BT-49", "Electronic address", "text"),
    f(
      at("electronicAddress.scheme"),
      undefined,
      "Electronic address scheme",
      "code",
      undefined,
      `Scheme identifier of the electronic address (EN 16931 attribute ${
        isSeller ? "BT-34-1" : "BT-49-1"
      }, EAS code list) — mandatory whenever the address is present.`,
    ),
  ];
  return {
    bg,
    title: bgTitle(bg, isSeller ? "Seller" : "Buyer"),
    cardinality: bgCardinality(bg, "1..1"),
    fields,
    subgroups: [
      {
        bg: addressBg,
        title: "Postal address",
        cardinality: bgCardinality(addressBg, "1..1"),
        fields: [
          f(at("address.street"), isSeller ? "BT-35" : "BT-50", "Address line 1", "text"),
          f(at("address.number"), isSeller ? "BT-36" : "BT-51", "Address line 2", "text"),
          f(at("address.city"), isSeller ? "BT-37" : "BT-52", "City", "text"),
          f(at("address.postCode"), isSeller ? "BT-38" : "BT-53", "Post code", "text"),
          f(at("address.region"), isSeller ? "BT-39" : "BT-54", "Country subdivision", "text"),
          f(at("address.country"), isSeller ? "BT-40" : "BT-55", "Country code", "code"),
        ],
      },
      {
        bg: contactBg,
        title: "Contact",
        cardinality: bgCardinality(contactBg, "0..1"),
        fields: [
          f(at("contact.name"), isSeller ? "BT-41" : "BT-56", "Contact point", "text"),
          f(at("contact.phone"), isSeller ? "BT-42" : "BT-57", "Contact telephone", "text"),
          f(at("contact.email"), isSeller ? "BT-43" : "BT-58", "Contact email", "text"),
        ],
      },
    ],
  } satisfies GroupSpec;
}

export function invoiceGroups(): GroupSpec[] {
  return [
    {
      bg: "BG-0",
      title: "Document",
      cardinality: bgCardinality("BG-0", "1..1"),
      fields: [
        f("number", "BT-1", "Invoice number", "text"),
        f("issueDate", "BT-2", "Issue date", "date"),
        f("typeCode", "BT-3", "Document type code", "code", DOCUMENT_TYPES),
        f("currency", "BT-5", "Currency", "code"),
        f("dueDate", "BT-9", "Payment due date", "date"),
        f("references.buyerReference", "BT-10", "Buyer reference", "text"),
        f("references.project", "BT-11", "Project reference", "text"),
        f("references.contract", "BT-12", "Contract reference", "text"),
        f("references.purchaseOrder", "BT-13", "Purchase order reference", "text"),
        f("references.salesOrder", "BT-14", "Sales order reference", "text"),
        f("references.despatchAdvice.number", "BT-16", "Despatch advice reference", "text"),
        f("references.tenderOrLot", "BT-17", "Tender or lot reference", "text"),
        f("references.invoicedObject", "BT-18", "Invoiced object identifier", "text"),
        f("payment.terms", "BT-20", "Payment terms", "longtext"),
      ],
      subgroups: [
        {
          bg: "BG-1",
          title: "Invoice note",
          cardinality: bgCardinality("BG-1", "0..n"),
          fields: [f("note", "BT-22", "Note", "longtext")],
        },
        {
          bg: "BG-3",
          title: "Preceding invoice reference",
          cardinality: bgCardinality("BG-3", "0..n"),
          fields: [
            f("references.precedingInvoice.number", "BT-25", "Preceding invoice number", "text"),
            f("references.precedingInvoice.issueDate", "BT-26", "Preceding invoice date", "date"),
          ],
        },
      ],
    },
    party("seller", "BG-4", "BG-5", "BG-6"),
    party("buyer", "BG-7", "BG-8", "BG-9"),
    {
      bg: "BG-13",
      title: "Delivery",
      cardinality: bgCardinality("BG-13", "0..1"),
      fields: [f("delivery.date", "BT-72", "Actual delivery date", "date")],
    },
    {
      bg: "BG-16",
      title: "Payment instructions",
      cardinality: bgCardinality("BG-16", "0..1"),
      fields: [
        f("payment.meansCode", "BT-81", "Payment means code", "code"),
        f("payment.meansText", "BT-82", "Payment means text", "text"),
        f("payment.remittanceInformation", "BT-83", "Remittance information", "text"),
      ],
      subgroups: [
        {
          bg: "BG-17",
          title: "Credit transfer",
          cardinality: bgCardinality("BG-17", "0..n"),
          fields: [
            f("payment.iban", "BT-84", "Payment account identifier", "text"),
            f("payment.accountName", "BT-85", "Payment account name", "text"),
            f("payment.bic", "BT-86", "Payment service provider identifier", "text"),
          ],
        },
      ],
    },
    {
      bg: "BG-23",
      title: "VAT breakdown",
      cardinality: bgCardinality("BG-23", "1..n"),
      repeatable: { basePath: "vatBreakdown", countPath: "vatBreakdown" },
      fields: [
        f("vatBreakdown.{i}.category", "BT-118", "VAT category code", "code", VAT_CATEGORIES),
        f("vatBreakdown.{i}.rate", "BT-119", "VAT rate", "decimal"),
        f("vatBreakdown.{i}.taxableAmount", "BT-116", "Taxable amount", "decimal"),
        f("vatBreakdown.{i}.taxAmount", "BT-117", "VAT amount", "decimal"),
        f("vatBreakdown.{i}.reason", "BT-120", "VAT exemption reason text", "longtext"),
        f("vatBreakdown.{i}.vatexCode", "BT-121", "VAT exemption reason code", "code"),
        f(
          "vatBreakdown.{i}.natura",
          undefined,
          "Natura (FatturaPA)",
          "code",
          NATURA,
          `${FPA} 2.2.2.2 Natura — no EN 16931 term; required by SDI check 00429 when the rate is 0.`,
        ),
        f(
          "vatBreakdown.{i}.esigibilita",
          undefined,
          "Esigibilita IVA (FatturaPA)",
          "code",
          ESIGIBILITA,
          `${FPA} 2.2.2.7 EsigibilitaIVA — no EN 16931 term. I immediata, D differita, S scissione dei pagamenti.`,
        ),
      ],
    },
    {
      bg: "BG-22",
      title: "Document totals",
      cardinality: bgCardinality("BG-22", "1..1"),
      fields: [
        f("totals.lineExtension", "BT-106", "Sum of line net amounts", "decimal"),
        f("totals.allowance", "BT-107", "Sum of allowances", "decimal"),
        f("totals.charge", "BT-108", "Sum of charges", "decimal"),
        f("totals.taxExclusive", "BT-109", "Total without VAT", "decimal"),
        f("totals.taxAmount", "BT-110", "Total VAT amount", "decimal"),
        f("totals.taxInclusive", "BT-112", "Total with VAT", "decimal"),
        f("totals.prepaid", "BT-113", "Paid amount", "decimal"),
        f("totals.rounding", "BT-114", "Rounding amount", "decimal"),
        f("totals.payable", "BT-115", "Amount due for payment", "decimal"),
      ],
    },
    {
      bg: "BG-25",
      title: "Invoice lines",
      cardinality: bgCardinality("BG-25", "1..n"),
      repeatable: { basePath: "lines", countPath: "lines" },
      fields: [
        f("lines.{i}.id", "BT-126", "Line identifier", "text"),
        f("lines.{i}.name", "BT-153", "Item name", "text"),
        f("lines.{i}.description", "BT-154", "Item description", "longtext"),
        f("lines.{i}.quantity", "BT-129", "Invoiced quantity", "decimal"),
        f("lines.{i}.unitCode", "BT-130", "Unit of measure", "code", UNIT_CODES),
        f("lines.{i}.unitPriceNet", "BT-146", "Item net price", "decimal"),
        f("lines.{i}.netAmount", "BT-131", "Line net amount", "decimal"),
        f("lines.{i}.vat.category", "BT-151", "Line VAT category code", "code", VAT_CATEGORIES),
        f("lines.{i}.vat.rate", "BT-152", "Line VAT rate", "decimal"),
        f(
          "lines.{i}.vat.natura",
          undefined,
          "Line natura (FatturaPA)",
          "code",
          NATURA,
          `${FPA} 2.2.1.14 Natura — no EN 16931 term; required by SDI check 00400 when the line rate is 0.`,
        ),
        f(
          "lines.{i}.vat.reason",
          undefined,
          "Line VAT exemption reason text",
          "longtext",
          undefined,
          "No EN 16931 line-level term — BG-30 carries only the category and rate, and no XML " +
            "format writes it. Read by uapi-map.ts as the reason of a VAT_EXEMPTION line.",
        ),
        f(
          "lines.{i}.vat.vatexCode",
          undefined,
          "Line VAT exemption reason code",
          "code",
          undefined,
          "No EN 16931 line-level term — the VATEX code belongs to the VAT breakdown (BT-121). " +
            "No format reads or writes it on a line; the path exists because lines and the " +
            "breakdown share the Vat type.",
        ),
        f(
          "lines.{i}.it.altriDatiGestionali.tipoDato",
          undefined,
          "Management data type (FatturaPA)",
          "text",
          undefined,
          `${FPA} 2.2.1.16.1 AltriDatiGestionali/TipoDato — no EN 16931 term (e.g. INTENTO for a letter of intent).`,
        ),
        f(
          "lines.{i}.it.altriDatiGestionali.riferimentoTesto",
          undefined,
          "Management data text (FatturaPA)",
          "text",
          undefined,
          `${FPA} 2.2.1.16.2 AltriDatiGestionali/RiferimentoTesto — no EN 16931 term.`,
        ),
        f(
          "lines.{i}.it.altriDatiGestionali.riferimentoNumero",
          undefined,
          "Management data number (FatturaPA)",
          "decimal",
          undefined,
          `${FPA} 2.2.1.16.3 AltriDatiGestionali/RiferimentoNumero — no EN 16931 term.`,
        ),
        f(
          "lines.{i}.it.altriDatiGestionali.riferimentoData",
          undefined,
          "Management data date (FatturaPA)",
          "date",
          undefined,
          `${FPA} 2.2.1.16.4 AltriDatiGestionali/RiferimentoData — no EN 16931 term.`,
        ),
      ],
    },
    {
      bg: "FPA",
      title: "FatturaPA-specific",
      cardinality: "0..1",
      fields: [
        f(
          "it.bollo.virtuale",
          undefined,
          "Virtual stamp duty indicator",
          "code",
          BOLLO_VIRTUALE,
          `${FPA} 2.1.1.6.1 DatiBollo/BolloVirtuale — no EN 16931 term (DPR 642/1972).`,
        ),
        f(
          "it.bollo.amount",
          undefined,
          "Stamp duty amount",
          "decimal",
          undefined,
          `${FPA} 2.1.1.6.2 DatiBollo/ImportoBollo — no EN 16931 term (EUR 2.00 marca da bollo).`,
        ),
        f(
          "it.cup",
          undefined,
          "CUP - codice unico di progetto",
          "text",
          undefined,
          `${FPA} 2.1.2.6 CUP — no EN 16931 term (L. 3/2003 art. 11); mandatory for public works.`,
        ),
        f(
          "it.cig",
          undefined,
          "CIG - codice identificativo gara",
          "text",
          undefined,
          `${FPA} 2.1.2.7 CIG — no EN 16931 term (L. 136/2010 art. 3); mandatory for public tenders.`,
        ),
        f(
          "references.despatchAdvice.issueDate",
          undefined,
          "Despatch advice date",
          "date",
          undefined,
          `${FPA} 2.1.8.2 DatiDDT/DataDDT — no EN 16931 term (EN carries only the reference, BT-16); mandatory inside DatiDDT (XSD 1.2.3).`,
        ),
      ],
      subgroups: [
        {
          bg: "FPA-SELLER",
          title: "FatturaPA seller registration",
          cardinality: "0..1",
          fields: [
            f(
              "seller.it.regimeFiscale",
              undefined,
              "Tax regime (RegimeFiscale)",
              "code",
              REGIME_FISCALE,
              `${FPA} 1.2.1.8 RegimeFiscale — no EN 16931 term; mandatory for the cedente prestatore.`,
            ),
            f(
              "seller.it.rea.office",
              undefined,
              "REA registration office",
              "text",
              undefined,
              `${FPA} 1.2.4.1 IscrizioneREA/Ufficio — no EN 16931 term; province code of the chamber of commerce.`,
            ),
            f(
              "seller.it.rea.number",
              undefined,
              "REA registration number",
              "text",
              undefined,
              `${FPA} 1.2.4.2 IscrizioneREA/NumeroREA — no EN 16931 term.`,
            ),
            f(
              "seller.it.rea.capital",
              undefined,
              "Share capital",
              "decimal",
              undefined,
              `${FPA} 1.2.4.3 IscrizioneREA/CapitaleSociale — no EN 16931 term; required for SpA/SRL/SAPA.`,
            ),
            f(
              "seller.it.rea.soleShareholder",
              undefined,
              "Sole shareholder indicator",
              "code",
              SOCIO_UNICO,
              `${FPA} 1.2.4.4 IscrizioneREA/SocioUnico — no EN 16931 term. SU socio unico, SM piu soci.`,
            ),
            f(
              "seller.it.rea.liquidation",
              undefined,
              "Liquidation status",
              "code",
              STATO_LIQUIDAZIONE,
              `${FPA} 1.2.4.5 IscrizioneREA/StatoLiquidazione — no EN 16931 term. LS in liquidazione, LN non in liquidazione.`,
            ),
          ],
        },
        {
          bg: "FPA-BUYER",
          title: "FatturaPA buyer registration",
          cardinality: "0..1",
          fields: [
            f(
              "buyer.taxId",
              undefined,
              "Tax registration identifier (codice fiscale)",
              "text",
              undefined,
              `${FPA} 1.4.1.2 CodiceFiscale — EN 16931 has no buyer tax registration term (BT-32 is seller-only); SDI check 00417 needs this or the VAT id.`,
            ),
          ],
        },
        {
          bg: "FPA-PAYMENT",
          title: "FatturaPA payment",
          cardinality: "0..1",
          fields: [
            f(
              "payment.conditions",
              undefined,
              "Payment conditions (CondizioniPagamento)",
              "code",
              CONDIZIONI_PAGAMENTO,
              `${FPA} 2.4.1 CondizioniPagamento — no EN 16931 term. TP01 a rate, TP02 completo, TP03 anticipo.`,
            ),
            f(
              "payment.italianMeansCode",
              undefined,
              "Payment means (ModalitaPagamento)",
              "code",
              MODALITA_PAGAMENTO,
              `${FPA} 2.4.2.2 ModalitaPagamento — the Italian counterpart of BT-81 (UNCL4461), MP01-MP23.`,
            ),
          ],
        },
      ],
    },
    {
      bg: "CHANNEL",
      title: "Delivery channel",
      cardinality: "1..1",
      fields: [
        f(
          "buyer.channel.codiceDestinatario",
          undefined,
          "SDI destination code",
          "text",
          undefined,
          `${FPA} 1.1.4 CodiceDestinatario — routing metadata, not an EN 16931 term. 7 characters for FPR12, 6 for FPA12; "0000000" defers delivery to the PEC address.`,
        ),
        f(
          "buyer.channel.pec",
          undefined,
          "Recipient PEC address",
          "text",
          undefined,
          `${FPA} 1.1.6 PECDestinatario — routing metadata, not an EN 16931 term; required when the destination code is "0000000".`,
        ),
        f(
          "buyer.channel.participantId",
          undefined,
          "Peppol participant identifier",
          "text",
          undefined,
          "Peppol BIS Billing 3.0 receiver id (ISO 6523 scheme:value, e.g. 0204 Leitweg-ID) — SML/SMP routing metadata, carried outside the invoice document.",
        ),
        f(
          "buyer.channel.email",
          undefined,
          "Recipient email address",
          "text",
          undefined,
          "Delivery address for the email channel — routing metadata, not an EN 16931 term and not written into the XML.",
        ),
        f(
          "buyer.channel.format",
          undefined,
          "Email attachment format",
          "code",
          EMAIL_ATTACHMENT_FORMATS,
          "Which document the email carries (ZUGFeRD 2.x PDF/A-3 or an XRechnung 3.x XML) — routing metadata, not an EN 16931 term.",
        ),
      ],
    },
  ];
}

export function resolveField(field: FieldId, index: number): FieldId {
  return field.replace("{i}", String(index)) as FieldId;
}

export function rowCount(invoice: Invoice, group: GroupSpec): number {
  if (!group.repeatable) return 1;
  const rows = invoice[group.repeatable.countPath];
  return Array.isArray(rows) ? rows.length : 0;
}

const CARRIED = new Map<string, Set<string>>();

export function formatCarries(formatId: FormatId, field: FieldId): boolean {
  let carried = CARRIED.get(formatId);
  if (!carried) {
    carried = new Set(getFormat(formatId).map.map((row) => row.field));
    CARRIED.set(formatId, carried);
  }
  if (carried.has(field)) return true;
  return carried.has(genericField(field));
}

// "lines.2.it.altriDatiGestionali.tipoDato" -> "lines.{i}.it.altriDatiGestionali.tipoDato"
export function genericField(field: FieldId): FieldId {
  return field.replace(/\.\d+(?=\.|$)/g, ".{i}") as FieldId;
}

export function allFields(): FieldSpec[] {
  const out: FieldSpec[] = [];
  const walk = (groups: GroupSpec[]) => {
    for (const group of groups) {
      out.push(...group.fields);
      if (group.subgroups) walk(group.subgroups);
    }
  };
  walk(invoiceGroups());
  return out;
}
