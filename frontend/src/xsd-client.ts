import { normaliseLocation } from "./svrl";

export const XSD_ENDPOINT = "/api/validate/xsd";

export type XsdError = {
  line: number | null;
  column: number | null;
  message: string;
  path: string | null;
};

export type XsdOutcome =
  { status: "ok"; valid: boolean; errors: XsdError[] } | { status: "unavailable"; reason: string };

const ROOT_ELEMENT = /<\s*([A-Za-z_][\w.:-]*)/;

export function rootElementName(xml: string): string | undefined {
  const body = xml.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  return ROOT_ELEMENT.exec(body)?.[1];
}

// lxml reports `/*/cbc:ID` or `/*/cac:InvoiceLine[2]/cbc:ID`: prefixed names, a wildcard root
// and 1-based positions. normaliseLocation() turns the positions into the project's 0-based
// occurrence suffix; only the root wildcard has to be filled in from the document itself.
export function toDocumentPath(path: string | null, xml: string): string | undefined {
  if (!path) return undefined;
  const normalised = normaliseLocation(path);
  if (!normalised) return undefined;
  if (!normalised.startsWith("*")) return normalised;
  const root = rootElementName(xml);
  return root ? `${root}${normalised.slice(1)}` : undefined;
}

function reason(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `The XSD validation service (${XSD_ENDPOINT}) is not reachable: ${detail}. Start the backend with "make dev".`;
}

export async function validateXsd(
  schema: string,
  xml: string,
  signal?: AbortSignal,
): Promise<XsdOutcome> {
  let response: Response;
  try {
    response = await fetch(XSD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema, xml }),
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
        `POST ${XSD_ENDPOINT} answered ${response.status} ${response.statusText}` +
        `${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { status: "unavailable", reason: reason(error) };
  }
  const result = body as { valid?: unknown; findings?: unknown };
  if (typeof result.valid !== "boolean" || !Array.isArray(result.findings)) {
    return { status: "unavailable", reason: `${XSD_ENDPOINT} returned an unexpected payload.` };
  }
  return {
    status: "ok",
    valid: result.valid,
    errors: (result.findings as XsdError[]).map((entry) => ({
      line: typeof entry.line === "number" && entry.line > 0 ? entry.line : null,
      column: typeof entry.column === "number" && entry.column > 0 ? entry.column : null,
      message: String(entry.message ?? "").trim(),
      path: entry.path ?? null,
    })),
  };
}
