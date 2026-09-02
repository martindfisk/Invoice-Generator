export const SPEC_FIELDS_ENDPOINT = "/api/spec/fields";

export type SpecApplicabilityStatus =
  "applicable" | "not_required" | "not_applicable" | "not_supported";

export type SpecApplicability = { status: SpecApplicabilityStatus; note: string | null };

export type SpecField = {
  pointer: string;
  kind: "leaf" | "group" | "map";
  type: string | null;
  schema: string | null;
  required: boolean;
  optional_ancestor: string | null;
  constraints: Record<string, unknown>;
  description: string | null;
  example: unknown;
  example_source: string | null;
  bt: string[];
  applicability: Record<string, SpecApplicability>;
  applicable: boolean;
  variants: Record<string, string[]>;
};

export type SpecUnion = { pointer: string; property_name: string | null; values: string[] };

export type SpecFields = {
  api_version: string;
  source: string;
  source_sha256: string;
  country: string;
  operation: string;
  profile: string | null;
  fields: SpecField[];
  unions: SpecUnion[];
  warnings: string[];
};

export type SpecFieldsOutcome =
  { status: "ok"; spec: SpecFields } | { status: "unavailable"; reason: string };

// The metadata is derived from a vendored file, so it only changes when someone drops a new spec
// and restarts the backend. One entry per country/operation for the life of the page; the sha is
// carried in the payload so a caller can tell one spec's answer from another's.
const cache = new Map<string, SpecFields>();

function reason(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `The spec field catalogue (${SPEC_FIELDS_ENDPOINT}) is not reachable: ${detail}. Start the backend with "make dev".`;
}

export function clearSpecFieldsCache(): void {
  cache.clear();
}

export async function loadSpecFields(
  country: string | undefined,
  operation: "INVOICE" | "CORRECTION",
  signal?: AbortSignal,
): Promise<SpecFieldsOutcome> {
  const resolved = country?.toUpperCase() ?? "IT";
  const key = `${resolved}:${operation}`;
  const hit = cache.get(key);
  if (hit) return { status: "ok", spec: hit };
  const query = new URLSearchParams({ country: resolved, operation });
  let response: Response;
  try {
    response = await fetch(`${SPEC_FIELDS_ENDPOINT}?${query}`, { signal });
  } catch (error) {
    return { status: "unavailable", reason: reason(error) };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      status: "unavailable",
      reason:
        `GET ${SPEC_FIELDS_ENDPOINT} answered ${response.status} ${response.statusText}` +
        `${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { status: "unavailable", reason: reason(error) };
  }
  const spec = body as Partial<SpecFields>;
  if (!Array.isArray(spec.fields) || !Array.isArray(spec.unions) || !spec.source_sha256) {
    return {
      status: "unavailable",
      reason: `${SPEC_FIELDS_ENDPOINT} returned an unexpected payload.`,
    };
  }
  const resolvedSpec = spec as SpecFields;
  cache.set(key, resolvedSpec);
  return { status: "ok", spec: resolvedSpec };
}
