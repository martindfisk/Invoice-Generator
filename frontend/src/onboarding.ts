import type { Persona } from "./api-log";
import type {
  CollectionSummary,
  OnboardingCountry,
  OnboardingStatus,
  OnboardingSystem,
  OnboardingTaxpayer,
} from "./uapi-client";

export type CountryRow = {
  code: OnboardingCountry;
  label: string;
  registration: "SDI" | "PEPPOL";
};

// Metadata only — the *list* of selectable countries is derived from what the backend serves
// (collections, or the `ready` keys of the onboarding status), never from this record alone,
// so a country the app stops supporting cannot linger here as a phantom row.
const COUNTRY_INFO: Record<string, CountryRow> = {
  DE: { code: "DE", label: "Germany", registration: "PEPPOL" },
  IT: { code: "IT", label: "Italy", registration: "SDI" },
  BE: { code: "BE", label: "Belgium", registration: "PEPPOL" },
};

const PREFERRED_ORDER = Object.keys(COUNTRY_INFO);

export function countryRow(code: string): CountryRow {
  return (
    COUNTRY_INFO[code] ?? {
      code: code as OnboardingCountry,
      label: code,
      registration: "PEPPOL",
    }
  );
}

export function availableCountries(
  collections: Pick<CollectionSummary, "id">[] | null,
  statuses: (OnboardingStatus | null | undefined)[],
): CountryRow[] {
  const codes: string[] = [];
  const add = (code: string) => {
    if (/^[A-Z]{2}$/.test(code) && !codes.includes(code)) codes.push(code);
  };
  for (const collection of collections ?? []) add(collection.id.toUpperCase());
  if (codes.length === 0) {
    for (const status of statuses) {
      for (const code of Object.keys(status?.ready ?? {})) add(code.toUpperCase());
    }
  }
  codes.sort((a, b) => {
    const left = PREFERRED_ORDER.indexOf(a);
    const right = PREFERRED_ORDER.indexOf(b);
    return (
      (left === -1 ? PREFERRED_ORDER.length : left) -
      (right === -1 ? PREFERRED_ORDER.length : right)
    );
  });
  return codes.map(countryRow);
}

export type TreeFetch = {
  status: OnboardingStatus | null;
  error: string | null;
  loading: boolean;
};

export const IDLE_FETCH: TreeFetch = { status: null, error: null, loading: false };

export function noCredentialsHint(persona: Persona): string {
  return (
    `No API credentials are configured for the ${persona}. This is not an empty fiskaly ` +
    `account — without a key the backend cannot ask fiskaly what exists. Add the API key and ` +
    `secret under Settings → Credentials.`
  );
}

export type NodeTone = "success" | "warning" | "neutral" | "missing";

export function taxpayerTone(taxpayer: OnboardingTaxpayer): NodeTone {
  return taxpayer.state === "COMMISSIONED" ? "success" : "neutral";
}

// Organizations and subjects use the ENABLED/DISABLED vocabulary, not the
// ACQUIRED → COMMISSIONED → DECOMMISSIONED lifecycle of taxpayers and systems. Anything
// unrecognised renders neutral with the raw value — never as an error.
export function accountTone(state: string | null | undefined): NodeTone {
  if (state === "ENABLED") return "success";
  if (state === "DISABLED") return "warning";
  return "neutral";
}

export const ACCOUNT_LIFECYCLE_HINT =
  "Organizations and subjects are ENABLED or DISABLED — a different lifecycle from taxpayers " +
  "and systems (ACQUIRED → COMMISSIONED → DECOMMISSIONED). ENABLED is their ready state.";

export const ACCOUNT_NOT_REPORTED =
  "comes with the account credentials — provisioning does not create these";

export function systemTone(system: OnboardingSystem): NodeTone {
  if (system.state !== "COMMISSIONED") return "neutral";
  if (system.mode === "OPERATIVE") return "success";
  if (system.mode === "DEGRADED") return "warning";
  return "neutral";
}

export function systemStateText(system: OnboardingSystem): string {
  const state = system.state ?? "unknown state";
  return system.mode ? `${state} / ${system.mode}` : state;
}

// Keys are the backend's blocked_by values normalized to UPPER_SNAKE — the backend emits
// "peppol-proof-of-ownership" (see backend/app/onboarding.py PEPPOL_BLOCKER).
const BLOCKED_WORDS: Record<string, string> = {
  PEPPOL_PROOF_OF_OWNERSHIP:
    "the Peppol proof of ownership of the taxpayer is still outstanding — completing fiskaly's " +
    "ownership verification unblocks transmission. This app cannot run that upload flow; use " +
    "the fiskaly dashboard",
};

export function blockedByLine(blockedBy: string): string {
  const key = blockedBy.toUpperCase().replace(/[\s-]+/g, "_");
  const words = BLOCKED_WORDS[key];
  if (words) return `Cannot transmit: ${words}.`;
  const plain = blockedBy.toLowerCase().replace(/_/g, " ");
  return `Cannot transmit: blocked by ${plain} — resolving it unblocks transmission.`;
}

export const DEGRADED_NO_CAUSE =
  "Cannot transmit while DEGRADED — fiskaly reported no blocking reason.";

export const COMPLIANCE_WORDS: Record<string, string> = {
  TRANSMISSION_RECEPTION: "sends and receives",
  TRANSMISSION_ONLY: "sends only — the account cannot receive inbound documents",
};

export function complianceGloss(compliance: string): string {
  const words = COMPLIANCE_WORDS[compliance];
  return words ? `${compliance} — ${words}` : `${compliance} — capability not recognised`;
}

// Everything healthy about a system goes into the tooltip; only what blocks a send earns its
// own visible line.
export function systemHint(system: OnboardingSystem): string {
  const parts: string[] = [];
  for (const registration of system.registrations ?? []) parts.push(registration.type);
  if (system.peppol_id) parts.push(system.peppol_id);
  if (system.compliance_state) parts.push(complianceGloss(system.compliance_state));
  return parts.join(" · ");
}

function taxpayerCountry(taxpayer: OnboardingTaxpayer): string | null {
  return taxpayer.country ?? taxpayer.fiscalization_type ?? null;
}

export function countryEntities(
  status: OnboardingStatus,
  code: OnboardingCountry,
): { taxpayers: OnboardingTaxpayer[]; systems: OnboardingSystem[] } {
  const taxpayers = status.taxpayers.filter(
    (taxpayer) => taxpayerCountry(taxpayer) === code && taxpayer.state !== "DECOMMISSIONED",
  );
  const ids = new Set(taxpayers.map((taxpayer) => taxpayer.id));
  const systems = status.systems.filter(
    (system) =>
      system.state !== "DECOMMISSIONED" && ids.has(system.taxpayer_id ?? system.location_id ?? ""),
  );
  return { taxpayers, systems };
}

export function missingLines(status: OnboardingStatus, code: OnboardingCountry): string[] {
  return (status.missing ?? []).filter((line) => line.startsWith(`${code}:`));
}

export const ONE_WAY_NOTE =
  "Commissioning is a one-way state transition (ACQUIRED → COMMISSIONED → DECOMMISSIONED); a " +
  "commissioned resource cannot go back.";

export const TEST_BILLING_NOTE =
  "TEST resources are not billed — billing starts only when a system is commissioned on LIVE.";

export const LIVE_BILLING_NOTE =
  "This is the LIVE environment: commissioning a system here starts billing.";

export const IT_SECRETS_NOTE =
  "FISCONLINE credentials are personal tax-authority secrets. They are sent once, inside this " +
  "provisioning request, and are never stored, logged or shown by this browser.";

export function verbatim(error: unknown): string {
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
