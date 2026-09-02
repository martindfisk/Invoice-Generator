import type { FormatId } from "./model";

export type FieldFate = "mapped" | "not-rendered" | "discarded" | "platform";

export type FateEntry = { pointer: string; fate: FieldFate; element?: string; note: string };

type FateLookup = (formatId: FormatId, pointer: string) => FateEntry | undefined;

// uapi-field-fate.ts is the evidence table distilled from docs/reference/fatturapa/. The glob
// keeps this module loadable while that file does not exist yet; "no table" and "no entry"
// both mean: annotate nothing.
const modules = import.meta.glob<{ fateFor?: FateLookup }>("./uapi-field-fate.ts", {
  eager: true,
});

const lookup: FateLookup | undefined = modules["./uapi-field-fate.ts"]?.fateFor;

export function fateEntry(formatId: FormatId, pointer: string): FateEntry | undefined {
  if (!lookup) return undefined;
  try {
    const entry = lookup(formatId, pointer);
    return entry && entry.fate !== "mapped" ? entry : undefined;
  } catch {
    return undefined;
  }
}

export const FATE_LEGEND: { fate: Exclude<FieldFate, "mapped">; label: string; title: string }[] = [
  {
    fate: "discarded",
    label: "discarded",
    title: "Accepted by the API, then thrown away by the generator.",
  },
  {
    fate: "not-rendered",
    label: "not rendered",
    title: "Accepted by the API; produces no element in the XML.",
  },
  {
    fate: "platform",
    label: "platform",
    title: "Comes from the Taxpayer or System entity, not from this payload.",
  },
];

export const FATE_TONE: Record<string, string> = {
  discarded: "text-warning-ink",
  "not-rendered": "text-muted",
  platform: "text-info",
};

export function fateLabel(fate: FieldFate): string {
  return FATE_LEGEND.find((entry) => entry.fate === fate)?.label ?? fate;
}

export const FATTURAPA_TOTALS_NOTICE =
  "breakdown and totals are discarded — fiskaly recomputes DatiRiepilogo server-side from the " +
  "entries. The API schema still requires both, so this payload keeps sending them; editing " +
  "them changes nothing in the transmitted XML.";

export const FATTURAPA_SELLER_NOTICE =
  "The seller block is mostly platform data — identity, address, RegimeFiscale and REA come " +
  "from the commissioned Taxpayer, not from this payload. Only seller.phone and seller.email " +
  "reach the XML; seller.name does not.";

export type FateNotice = { id: "totals" | "seller"; text: string };

// The capture behind these claims is a single FatturaPA transaction; UBL and CII went through
// no such observation, so the notices stay Italy-only rather than pretending to generalise.
export function formatFateNotices(formatId: FormatId): FateNotice[] {
  if (formatId !== "fatturapa") return [];
  return [
    { id: "totals", text: FATTURAPA_TOTALS_NOTICE },
    { id: "seller", text: FATTURAPA_SELLER_NOTICE },
  ];
}

export const FATTURAPA_DOCUMENT_TIER_NOTE =
  "FatturaPA: a finding about totals or the VAT breakdown here means the predicted document " +
  "is internally inconsistent — it does not predict rejection. fiskaly discards the payload's " +
  "breakdown and totals and recomputes DatiRiepilogo before transmitting.";

export function documentTierFateNote(formatId?: FormatId): string | null {
  return formatId === "fatturapa" ? FATTURAPA_DOCUMENT_TIER_NOTE : null;
}

export const FIELD_FATE_PROVENANCE =
  "The field-fate annotations in Compose and the FatturaPA recomputation note in Validate come " +
  "from one real TRANSACTION::INVOICE and the FatturaPA XML fiskaly's gateway generated from " +
  "it, captured 2026-08-25. The capture is kept verbatim in docs/reference/fatturapa/ in this " +
  "repository.";
