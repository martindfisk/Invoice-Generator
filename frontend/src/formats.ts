import { CII_MAP, CII_SPEC } from "./cii-map";
import { parseCii } from "./cii-parse";
import { writeCii } from "./cii-write";
import { FATTURAPA_MAP, FATTURAPA_SPEC } from "./fatturapa-map";
import { parseFatturapa } from "./fatturapa-parse";
import { writeFatturapa } from "./fatturapa-write";
import type { FormatId, Invoice, MappingRow } from "./model";
import { UBL_MAP } from "./ubl-map";
import { parseUbl } from "./ubl-parse";
import { writeUbl } from "./ubl-write";
import { XRECHNUNG_MAP, XRECHNUNG_SPEC } from "./xrechnung-map";
import { parseXrechnung } from "./xrechnung-parse";
import { writeXrechnung } from "./xrechnung-write";

export type ValidationStage = "model" | "well-formed" | "xsd" | "schematron" | "sdi-rules";

export type FormatPlugin = {
  id: FormatId;
  label: string;
  spec: string;
  write(invoice: Invoice): string;
  parse(xml: string): Invoice;
  map: MappingRow[];
  xsdSchemaKey: string | null;
  validationStages: ValidationStage[];
  unsupportedReason?(invoice: Invoice): string | null;
};

const CREDIT_NOTE_IN_UBL_INVOICE =
  "UBL carries credit notes (type 381) in a CreditNote document, not an Invoice; " +
  "rendering this here would fail EN 16931 rule BR-CL-01. CreditNote output is not implemented yet.";

function rejectCreditNote(invoice: Invoice): string | null {
  return invoice.typeCode === "381" ? CREDIT_NOTE_IN_UBL_INVOICE : null;
}

export const FORMATS: Record<FormatId, FormatPlugin> = {
  ubl: {
    id: "ubl",
    label: "Peppol BIS Billing 3.0 (UBL 2.1)",
    spec: "Peppol BIS Billing 3.0 on EN 16931-1:2017 / UBL 2.1",
    write: writeUbl,
    parse: parseUbl,
    map: UBL_MAP,
    xsdSchemaKey: "ubl-invoice-2.1",
    validationStages: ["model", "well-formed", "xsd", "schematron"],
    unsupportedReason: rejectCreditNote,
  },
  xrechnung: {
    id: "xrechnung",
    label: "XRechnung 3.0.2 (UBL 2.1)",
    spec: XRECHNUNG_SPEC,
    write: writeXrechnung,
    parse: parseXrechnung,
    map: XRECHNUNG_MAP,
    xsdSchemaKey: "ubl-invoice-2.1",
    validationStages: ["model", "well-formed", "xsd", "schematron"],
    unsupportedReason: rejectCreditNote,
  },
  cii: {
    id: "cii",
    label: "UN/CEFACT CII (Factur-X / ZUGFeRD EN 16931)",
    spec: CII_SPEC,
    write: writeCii,
    parse: parseCii,
    map: CII_MAP,
    // No XSD is vendored for CII, so the format declares no xsd stage.
    xsdSchemaKey: null,
    validationStages: ["model", "well-formed", "schematron"],
  },
  fatturapa: {
    id: "fatturapa",
    label: "FatturaPA (SDI)",
    spec: FATTURAPA_SPEC,
    write: writeFatturapa,
    parse: parseFatturapa,
    map: FATTURAPA_MAP,
    xsdSchemaKey: "fatturapa-1.2",
    validationStages: ["model", "well-formed", "xsd", "sdi-rules"],
  },
};

export const FORMAT_IDS: FormatId[] = ["ubl", "xrechnung", "cii", "fatturapa"];

export function getFormat(id: FormatId): FormatPlugin {
  const plugin = FORMATS[id];
  if (!plugin) throw new Error(`formats: unknown format "${id}"`);
  return plugin;
}

export function unsupportedReason(id: FormatId, invoice: Invoice): string | null {
  const plugin = getFormat(id);
  return plugin.unsupportedReason ? plugin.unsupportedReason(invoice) : null;
}
