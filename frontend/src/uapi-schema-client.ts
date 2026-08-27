export const UAPI_SCHEMA_ENDPOINT = "/api/validate/uapi";

// fiskaly publishes the e-invoice OpenAPI document per country and `make spec` fetches these two.
// Their InvoiceTransaction graphs differ only in three `description` strings — not one constraint —
// so a German or French invoice is checked against the Italian copy rather than skipped.
export const SPEC_COUNTRIES = ["IT", "BE"];

export function specCountry(country: string | undefined): string | undefined {
  const wanted = country?.toUpperCase();
  return wanted && SPEC_COUNTRIES.includes(wanted) ? wanted : undefined;
}

export type UapiSchemaError = { pointer: string; keyword: string; message: string };

export type UapiSchemaOutcome =
  | { status: "ok"; valid: boolean; country: string; errors: UapiSchemaError[] }
  | { status: "unavailable"; reason: string };

function reason(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `The fiskaly contract check (${UAPI_SCHEMA_ENDPOINT}) is not reachable: ${detail}. Start the backend with "make dev".`;
}

export async function validateUapiOperation(
  operation: unknown,
  country?: string,
  signal?: AbortSignal,
): Promise<UapiSchemaOutcome> {
  if (operation === null || typeof operation !== "object" || Array.isArray(operation)) {
    return {
      status: "unavailable",
      reason: "The operation is not a JSON object, so there is nothing to check against the spec.",
    };
  }
  const resolved = specCountry(country);
  let response: Response;
  try {
    response = await fetch(UAPI_SCHEMA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resolved ? { operation, country: resolved } : { operation }),
      signal,
    });
  } catch (error) {
    return { status: "unavailable", reason: reason(error) };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      status: "unavailable",
      reason:
        `POST ${UAPI_SCHEMA_ENDPOINT} answered ${response.status} ${response.statusText}` +
        `${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { status: "unavailable", reason: reason(error) };
  }
  const result = body as { valid?: unknown; country?: unknown; findings?: unknown };
  if (typeof result.valid !== "boolean" || !Array.isArray(result.findings)) {
    return {
      status: "unavailable",
      reason: `${UAPI_SCHEMA_ENDPOINT} returned an unexpected payload.`,
    };
  }
  return {
    status: "ok",
    valid: result.valid,
    country: typeof result.country === "string" ? result.country : "",
    errors: (result.findings as UapiSchemaError[]).map((entry) => ({
      pointer: String(entry.pointer ?? ""),
      keyword: String(entry.keyword ?? "schema"),
      message: String(entry.message ?? "").trim(),
    })),
  };
}
