import { getFormat } from "./formats";
import type { FormatId, Invoice, Party } from "./model";
import { preset, type PresetId } from "./presets";
import {
  fromTaxpayer,
  invoiceOperation,
  type UapiContext,
  type UapiOperation,
  type UapiTaxpayer,
  type UapiVatExemption,
  type UapiVatRate,
} from "./uapi-map";
import { passthrough, type Config, type SettingsCountry } from "./uapi-client";
import { buildOperation, stringifyOperation } from "./uapi-json";

// A payload a customer or colleague authored themselves, run through the same Mapper and
// Validate steps as a preset — minus Send. The operation carries no seller and names VAT by
// system code, so the country decides the placeholder seller, the format list and how codes
// are decoded; everything else comes from the pasted text.

export type PastedCountry = SettingsCountry;

export const PASTE_COUNTRIES: { code: PastedCountry; name: string }[] = [
  { code: "IT", name: "Italy" },
  { code: "BE", name: "Belgium" },
  { code: "DE", name: "Germany" },
];

// The syntaxes each country's e-invoicing actually uses: FatturaPA over SDI, Peppol BIS over
// Peppol, and for Germany XRechnung (Peppol or e-mail) or a ZUGFeRD/Factur-X CII by e-mail.
// The Mapper's format switch still renders every other syntax afterwards.
const COUNTRY_FORMATS: Record<PastedCountry, FormatId[]> = {
  IT: ["fatturapa"],
  BE: ["ubl"],
  DE: ["xrechnung", "cii"],
};

export function formatsFor(country: PastedCountry): FormatId[] {
  return COUNTRY_FORMATS[country];
}

export function defaultFormat(country: PastedCountry): FormatId {
  return COUNTRY_FORMATS[country][0];
}

export function isPasteCountry(value: unknown): value is PastedCountry {
  return PASTE_COUNTRIES.some((entry) => entry.code === value);
}

// One reference scenario per country supplies the placeholder seller and the example text.
const REFERENCE: Record<PastedCountry, PresetId> = {
  IT: "it-b2b-sdi",
  BE: "be-peppol",
  DE: "de-hotel-b2g-xrechnung",
};

export function placeholderSeller(country: PastedCountry): Party {
  return preset(REFERENCE[country]).seller;
}

export function exampleText(country: PastedCountry): string {
  const built = buildOperation(preset(REFERENCE[country]), null);
  return built.error === null ? stringifyOperation(built.value) : "";
}

// Nothing from any preset leaks into a pasted payload: the base the reverse map fills from is
// empty apart from the placeholder seller and the chosen format. Lines and breakdown rows come
// entirely from the operation, references and payment only where the operation names them.
export function blankBase(country: PastedCountry, formatId: FormatId, seller?: Party): Invoice {
  return {
    format: formatId,
    number: "",
    issueDate: "",
    typeCode: "380",
    currency: "EUR",
    seller: seller ?? placeholderSeller(country),
    buyer: {
      name: "",
      address: { street: "", city: "", postCode: "", country },
      channel: { kind: "PEPPOL", participantId: "" },
    },
    lines: [],
    vatBreakdown: [],
    payment: { meansCode: "30" },
    totals: {
      lineExtension: "0.00",
      taxExclusive: "0.00",
      taxAmount: "0.00",
      taxInclusive: "0.00",
      payable: "0.00",
    },
  };
}

export type PastedSellerSource = "placeholder" | "taxpayer";

export function sellerNote(
  source: PastedSellerSource,
  seller: Party,
  country: PastedCountry,
): string {
  const name = seller.name || "(unnamed)";
  return source === "taxpayer"
    ? `Seller (BG-4): ${name} — your fiskaly taxpayer for ${country}. fiskaly takes the seller from the taxpayer, never from the payload.`
    : `Seller (BG-4): ${name} — a placeholder from the ${country} reference scenario. fiskaly takes the seller from your taxpayer, never from the payload; in LIVE with credentials the real one is read instead.`;
}

// The country picks the format, the SDI rules and the placeholder seller, so a recipient block
// that plainly belongs to another country is worth a warning before the Mapper opens — not a
// refusal, because the user may be testing exactly that mismatch.
export function recipientMismatch(operation: UapiOperation, country: PastedCountry): string | null {
  const recipient = invoiceOperation(operation).recipients?.[0];
  const invoicing = recipient?.invoicing;
  if (!invoicing) return null;
  if (invoicing.type === "SDI" && country !== "IT") {
    return `The recipient is addressed over SDI (destination code ${invoicing.destination_code}), which only exists for Italy — you chose ${country}.`;
  }
  if (invoicing.type !== "SDI" && country === "IT") {
    return `The recipient is addressed over ${invoicing.type}, but an Italian e-invoice goes to SDI (invoicing.type "SDI" with a destination code).`;
  }
  if (invoicing.type === "PEPPOL") {
    const scheme = invoicing.identifier.split(":")[0];
    if (scheme === "0204" && country !== "DE") {
      return `The Peppol identifier uses scheme 0204 (German Leitweg-ID) — you chose ${country}.`;
    }
    if (scheme === "0208" && country !== "BE") {
      return `The Peppol identifier uses scheme 0208 (Belgian KBO/BCE number) — you chose ${country}.`;
    }
  }
  const address = recipient?.address?.country;
  if (address && country === "IT" && address !== "IT") {
    return `The recipient's address is in ${address}; an SDI invoice to a foreign recipient normally uses destination code XXXXXXX.`;
  }
  return null;
}

export type PastedLookup = {
  seller?: Party;
  ctx: UapiContext;
  source: PastedSellerSource;
  note: string | null;
};

type SystemContent = { vat_rates?: UapiVatRate[]; vat_exemptions?: UapiVatExemption[] };

// In LIVE with a configured system and taxpayer the account supplies what the payload cannot:
// the seller party and the VAT code lists. MOCK and a missing configuration fall back to the
// placeholder and the built-in tables, and say so — the fixture taxpayer is Belgian whatever
// the country, which would be a worse lie than a labelled placeholder.
export async function lookupPasted(
  country: PastedCountry,
  config: Config | null,
  live: boolean,
): Promise<PastedLookup> {
  const ctx: UapiContext = { country };
  const ids = config?.systems?.[country];
  if (!live) {
    return {
      ctx,
      source: "placeholder",
      note: "MOCK mode — placeholder seller and built-in VAT code tables.",
    };
  }
  if (!ids?.system_id || !ids.taxpayer_id) {
    return {
      ctx,
      source: "placeholder",
      note: `No system and taxpayer are configured for ${country} (Settings) — placeholder seller and built-in VAT code tables.`,
    };
  }
  const [taxpayer, system] = await Promise.allSettled([
    passthrough<{ content: UapiTaxpayer }>("GET", `/taxpayers/${ids.taxpayer_id}`),
    passthrough<{ content: SystemContent }>("GET", `/systems/${ids.system_id}`),
  ]);
  const notes: string[] = [];
  let seller: Party | undefined;
  let source: PastedSellerSource = "placeholder";
  if (taxpayer.status === "fulfilled") {
    seller = fromTaxpayer(taxpayer.value.content);
    source = "taxpayer";
  } else {
    notes.push(`taxpayer ${ids.taxpayer_id} could not be read (${reason(taxpayer.reason)})`);
  }
  if (system.status === "fulfilled") {
    ctx.vatRates = system.value.content.vat_rates;
    ctx.vatExemptions = system.value.content.vat_exemptions;
  } else {
    notes.push(
      `system ${ids.system_id} could not be read (${reason(system.reason)}) — built-in VAT code tables apply`,
    );
  }
  return {
    seller,
    ctx,
    source,
    note: notes.length > 0 ? `From your fiskaly account, partly: ${notes.join("; ")}.` : null,
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatLabel(formatId: FormatId): string {
  return getFormat(formatId).label;
}
