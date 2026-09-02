// Resolves which compiled Schematron rule sets to run from public/sef/manifest.json, the
// catalogue `frontend/scripts/build-sef.mjs` emits next to the SEFs. The manifest carries each
// SEF's content sha256, which becomes both the parsed-SEF cache key and a ?v= cache-buster, so
// a rebuilt rule set of the same name can never be served stale. While the manifest does not
// exist yet (clean checkout before `make sef`), the hardcoded table below keeps validation
// working — keyed by URL, exactly the pre-manifest behaviour.
import type { FormatId } from "./model";

export const SEF_BASE = "/sef/";
export const SEF_MANIFEST_URL = `${SEF_BASE}manifest.json`;

// Which compiled rule sets each syntax is checked against, in the order a real access point
// applies them: the EN 16931 core rules first, then the CIUS on top. Names are the SEF base
// names produced by `frontend/scripts/build-sef.mjs` and served from `public/sef/`.
// XRechnung reuses `cen-ubl` rather than the standalone `en16931-ubl`: both are CEN 1.3.15 and
// differ only in the ISO 6523 / CEF EAS code list (the Peppol copy adds 0245), and sharing one
// SEF saves a second 8 MB fetch in a session that validates both syntaxes.
export const SCHEMATRON_RULE_SETS: Partial<Record<FormatId, string[]>> = {
  ubl: ["cen-ubl", "peppol-ubl"],
  xrechnung: ["cen-ubl", "xrechnung-ubl"],
  cii: ["en16931-cii"],
};

export type SefRuleSetInfo = {
  id: string;
  title: string;
  version: string;
  licence: string;
  formats: string[];
  order: number;
  sourceSha?: string;
  sef: { sha256: string; bytes?: number; saxonVersion?: string; buildDateTime?: string };
};

export type SefManifest = {
  generatedAt?: string;
  saxonJs?: string;
  ruleSets: SefRuleSetInfo[];
};

export type ResolvedRuleSet = { id: string; url: string; key: string; version?: string };

function isRuleSetInfo(value: unknown): value is SefRuleSetInfo {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  const sef = entry.sef as Record<string, unknown> | null | undefined;
  return (
    typeof entry.id === "string" &&
    typeof entry.version === "string" &&
    Array.isArray(entry.formats) &&
    typeof entry.order === "number" &&
    typeof sef === "object" &&
    sef !== null &&
    typeof sef.sha256 === "string"
  );
}

export function parseSefManifest(value: unknown): SefManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const ruleSets = (value as { ruleSets?: unknown }).ruleSets;
  if (!Array.isArray(ruleSets) || ruleSets.length === 0) return null;
  if (!ruleSets.every(isRuleSetInfo)) return null;
  return { ...(value as Record<string, unknown>), ruleSets } as SefManifest;
}

// "no-cache" revalidates the manifest itself on every read, so a `make sef` on disk is picked
// up by the very next validation run; the multi-MB SEFs stay cacheable because their URLs
// change with the content (?v=<sha256>).
export async function loadSefManifest(url = SEF_MANIFEST_URL): Promise<SefManifest | null> {
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return null;
    return parseSefManifest(await response.json());
  } catch {
    return null;
  }
}

export function ruleSetsByOrder(manifest: SefManifest): SefRuleSetInfo[] {
  return [...manifest.ruleSets].sort((a, b) => a.order - b.order);
}

export function resolveRuleSets(
  formatId: FormatId,
  manifest: SefManifest | null,
  base = SEF_BASE,
): ResolvedRuleSet[] {
  const fromManifest = (manifest ? ruleSetsByOrder(manifest) : [])
    .filter((entry) => entry.formats.includes(formatId))
    .map((entry) => ({
      id: entry.id,
      url: `${base}${entry.id}.sef.json?v=${entry.sef.sha256}`,
      key: entry.sef.sha256,
      version: entry.version,
    }));
  if (fromManifest.length > 0) return fromManifest;
  return (SCHEMATRON_RULE_SETS[formatId] ?? []).map((id) => {
    const url = `${base}${id}.sef.json`;
    return { id, url, key: url };
  });
}
