import { checkSdi, type SdiTransmission } from "./fatturapa-rules";
import { getFormat, type ValidationStage } from "./formats";
import { annotateKnownDefects } from "./known-defects";
import type { FormatId, Invoice } from "./model";
import { checkModel, type Severity } from "./model-rules";
import { loadSefManifest, resolveRuleSets } from "./schematron-sets";
import { runSchematron, type SchematronRun } from "./schematron.worker";
import { parseSvrl, type SvrlFinding } from "./svrl";
import { buildFieldIndex, type FieldIndex } from "./xml-locate";
import { fieldForPointer, toInvoiceTransaction, type UapiContext } from "./uapi-map";
import { validateUapiOperation, type UapiSchemaError } from "./uapi-schema-client";
import { toDocumentPath, validateXsd } from "./xsd-client";

export type { Severity };

export type FindingSource = ValidationStage | "fiskaly" | "uapi-schema";

export type Finding = {
  source: FindingSource;
  ruleId: string;
  severity: Severity;
  message: string;
  field?: string;
  xpath?: string;
  line?: number;
  column?: number;
  bt?: string;
  fpa?: string;
  test?: string;
  pointer?: string;
};

export type StageStatus = "pending" | "running" | "passed" | "failed" | "unavailable";

export type StageResult = {
  id: FindingSource;
  label: string;
  status: StageStatus;
  findings: Finding[];
  durationMs?: number;
  note?: string;
  // Which compiled rule sets produced the findings (schematron only). A missing version means
  // the run fell back to the built-in list because public/sef/manifest.json is not built yet.
  ruleSets?: { id: string; version?: string }[];
};

const STAGE_LABELS: Record<FindingSource, string> = {
  "uapi-schema": "fiskaly API contract",
  model: "Model rules",
  "well-formed": "Well-formedness",
  xsd: "XSD schema",
  schematron: "Schematron (EN 16931 / Peppol)",
  "sdi-rules": "SDI business rules",
  fiskaly: "fiskaly response",
};

// The fallback table lives in schematron-sets.ts next to the manifest resolution, so which
// rule sets run and which versions they carry come from one place; re-exported because the
// goldens test (and the format table it documents) address it here.
export { SCHEMATRON_RULE_SETS } from "./schematron-sets";

// formats.ts still lists CII as model + well-formedness only, from before the CEN CII rule set
// was vendored. The SEF exists now, so the stage is appended here; drop this once the format
// plugin lists it itself.
const EXTRA_STAGES: Partial<Record<FormatId, FindingSource[]>> = { cii: ["schematron"] };

// The UAPI operation is what an integrator actually authors, and fiskaly rejects a malformed one
// before any syntax exists to check — so this stage runs first, for every format, ahead of the
// stages that inspect the XML this browser predicts fiskaly will generate.
const UAPI_STAGE: FindingSource = "uapi-schema";

export function stagesFor(formatId: FormatId): { id: FindingSource; label: string }[] {
  const declared = getFormat(formatId).validationStages as FindingSource[];
  const extra = (EXTRA_STAGES[formatId] ?? []).filter((id) => !declared.includes(id));
  const all = [UAPI_STAGE, ...declared, ...extra].filter(
    (id, index, ids) => ids.indexOf(id) === index,
  );
  return all.map((id) => ({ id, label: STAGE_LABELS[id] }));
}

function pending(id: FindingSource): StageResult {
  return { id, label: STAGE_LABELS[id], status: "pending", findings: [] };
}

export function emptyRun(formatId: FormatId): StageResult[] {
  return stagesFor(formatId).map((stage) => pending(stage.id));
}

function settle(id: FindingSource, findings: Finding[], startedAt: number): StageResult {
  const blocking = findings.some((f) => f.severity === "fatal" || f.severity === "error");
  return {
    id,
    label: STAGE_LABELS[id],
    status: blocking ? "failed" : "passed",
    findings,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

// The XSD, Schematron and SDI stages inspect a document fiskaly has not produced: the browser's
// own rendering of the model. Their notes say so, so a green run is never mistaken for fiskaly
// having accepted anything.
export const PREDICTED_DOCUMENT_NOTE =
  "Checks the XML this browser predicts fiskaly will generate; fiskaly's transmitted document is fetched in Send.";

function unavailable(id: FindingSource, note: string): StageResult {
  return { id, label: STAGE_LABELS[id], status: "unavailable", findings: [], note };
}

export function checkWellFormed(xml: string): Finding[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (!error) return [];
  const text = (error.textContent ?? "XML is not well-formed").trim();
  const at = /line\s+(\d+)(?:\s+at\s+column\s+(\d+))?/i.exec(text);
  return [
    {
      source: "well-formed",
      ruleId: "XML-WF",
      severity: "fatal",
      message: text.split("\n")[0] ?? text,
      line: at ? Number(at[1]) : undefined,
      column: at?.[2] ? Number(at[2]) : undefined,
    },
  ];
}

export type ValidationInput = {
  invoice: Invoice;
  formatId: FormatId;
  xml: string;
  // Why the XML is empty when the format's writer refused the invoice. The XML-inspecting stages
  // then report unavailable with this reason instead of the whole pipeline being skipped — the
  // contract stage checks the JSON and must run regardless.
  xmlError?: string | null;
  // The JSON the Compose editor is showing. Omitted, the stage maps the invoice itself, which is
  // the same payload as long as the editor's JSON still round-trips.
  operation?: unknown;
  country?: string;
  uapiContext?: UapiContext;
  // Aborting stops the run between stages and cancels the in-flight backend calls, so a
  // superseded run does not keep computing behind the one that replaced it.
  signal?: AbortSignal;
};

export type StageRunner = (input: ValidationInput) => Promise<StageResult>;

const RUNNERS: Partial<Record<FindingSource, StageRunner>> = {};

export function registerStage(id: FindingSource, runner: StageRunner): void {
  RUNNERS[id] = runner;
}

async function runStage(id: FindingSource, input: ValidationInput): Promise<StageResult> {
  const startedAt = performance.now();
  if (id === "model") return settle(id, checkModel(input.invoice) as Finding[], startedAt);
  if (id === "well-formed") return settle(id, checkWellFormed(input.xml), startedAt);
  const runner = RUNNERS[id];
  if (!runner) return unavailable(id, `${STAGE_LABELS[id]} is not wired up yet.`);
  try {
    return await runner(input);
  } catch (error) {
    return {
      id,
      label: STAGE_LABELS[id],
      status: "unavailable",
      findings: [],
      note: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}

const XML_STAGES: ReadonlySet<FindingSource> = new Set([
  "well-formed",
  "xsd",
  "schematron",
  "sdi-rules",
]);

export async function runValidation(
  input: ValidationInput,
  onStage?: (stage: StageResult) => void,
): Promise<StageResult[]> {
  const results: StageResult[] = [];
  const writerNote =
    input.xml === ""
      ? `No XML to inspect — the ${getFormat(input.formatId).label} writer failed: ${input.xmlError ?? "no document was produced"}`
      : null;
  for (const stage of stagesFor(input.formatId)) {
    if (input.signal?.aborted) break;
    if (writerNote !== null && XML_STAGES.has(stage.id)) {
      const skipped = unavailable(stage.id, writerNote);
      results.push(skipped);
      onStage?.(skipped);
      continue;
    }
    onStage?.({ ...pending(stage.id), status: "running" });
    const result = await runStage(stage.id, input);
    results.push(result);
    onStage?.(result);
    if (stage.id === "well-formed" && result.status === "failed") {
      for (const remaining of stagesFor(input.formatId).slice(results.length)) {
        const skipped = unavailable(remaining.id, "Skipped — the XML is not well-formed.");
        results.push(skipped);
        onStage?.(skipped);
      }
      break;
    }
  }
  return results;
}

// A missing required property is reported against the object that should have held it, so the
// last pointer segment is the property the message names — that is the field to highlight.
export function pointerForError(error: UapiSchemaError): string {
  if (error.keyword !== "required") return error.pointer;
  const property = /'([^']+)' is a required property/.exec(error.message)?.[1];
  return property ? `${error.pointer}/${property}` : error.pointer;
}

export function uapiSchemaFinding(error: UapiSchemaError): Finding {
  const pointer = pointerForError(error);
  return {
    source: "uapi-schema",
    ruleId: `uapi/${error.keyword}`,
    severity: "error",
    message: error.message,
    field: fieldForPointer(pointer),
    pointer,
  };
}

export function operationFor(input: ValidationInput): unknown {
  return input.operation ?? toInvoiceTransaction(input.invoice, input.uapiContext);
}

registerStage("uapi-schema", async (input) => {
  const startedAt = performance.now();
  const country = input.country ?? input.invoice.seller.address.country;
  const outcome = await validateUapiOperation(operationFor(input), country, input.signal);
  if (outcome.status === "unavailable") return unavailable("uapi-schema", outcome.reason);
  const used = outcome.country || country?.toUpperCase() || "IT";
  const substitute = used === country?.toUpperCase() ? "" : ` — checked against the ${used} spec`;
  return {
    ...settle("uapi-schema", outcome.errors.map(uapiSchemaFinding), startedAt),
    note:
      "Checks the JSON body against components.schemas.InvoiceTransaction in the fetched " +
      `fiskaly OpenAPI spec (${used}${substitute}) — what the API itself would reject, ` +
      "before any XML exists.",
  };
});

registerStage("xsd", async (input) => {
  const startedAt = performance.now();
  const plugin = getFormat(input.formatId);
  const outcome = await validateXsd(plugin.xsdSchemaKey, input.xml, input.signal);
  if (outcome.status === "unavailable") {
    return unavailable("xsd", outcome.reason);
  }
  const findings: Finding[] = outcome.errors.map((error) => ({
    source: "xsd",
    ruleId: plugin.xsdSchemaKey ?? "xsd",
    severity: "fatal",
    message: error.message,
    line: error.line ?? undefined,
    column: error.column ?? undefined,
    xpath: toDocumentPath(error.path, input.xml),
  }));
  if (!outcome.valid && findings.length === 0) {
    findings.push({
      source: "xsd",
      ruleId: plugin.xsdSchemaKey ?? "xsd",
      severity: "fatal",
      message: "The document does not conform to the schema.",
    });
  }
  return {
    ...settle("xsd", findings, startedAt),
    note:
      `Validated against ${plugin.xsdSchemaKey} by the backend (lxml). ` + PREDICTED_DOCUMENT_NOTE,
  };
});

function schematronFinding(svrl: SvrlFinding, fields: FieldIndex): Finding {
  // A location pointing at the document element resolves to the first mapped field, which is
  // worse than no field at all, so only paths below the root are looked up.
  const field = svrl.xpath?.includes("/") ? fields.fieldForPath(svrl.xpath) : undefined;
  return {
    source: "schematron",
    ruleId: svrl.ruleId,
    severity: svrl.severity,
    message: svrl.message,
    field,
    xpath: svrl.xpath,
    bt: field ? fields.entry(field).bt : undefined,
    test: svrl.test,
  };
}

function nameRun(run: SchematronRun, versions: Map<string, string | undefined>): string {
  const version = versions.get(run.ruleSet);
  return `${run.ruleSet}${version ? ` ${version}` : ""} (${run.loadMs + run.runMs} ms)`;
}

registerStage("schematron", async (input) => {
  const startedAt = performance.now();
  const ruleSets = resolveRuleSets(input.formatId, await loadSefManifest());
  if (ruleSets.length === 0) {
    return unavailable("schematron", `No Schematron rule set is compiled for ${input.formatId}.`);
  }
  const runs = await runSchematron(input.xml, ruleSets);
  const fields = buildFieldIndex(input.invoice, getFormat(input.formatId).map);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    for (const entry of parseSvrl(run.svrl)) {
      const key = `${entry.ruleId}|${entry.xpath ?? ""}|${entry.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(schematronFinding(entry, fields));
    }
  }
  const annotated = annotateKnownDefects(findings, input.invoice);
  const versions = new Map(ruleSets.map((set) => [set.id, set.version]));
  return {
    ...settle("schematron", annotated, startedAt),
    ruleSets: ruleSets.map(({ id, version }) => ({ id, version })),
    note: `${runs.map((run) => nameRun(run, versions)).join(", ")}. ${PREDICTED_DOCUMENT_NOTE}`,
  };
});

export function transmissionFrom(xml: string): SdiTransmission | undefined {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror")[0]) return undefined;
  const read = (name: string) =>
    document.getElementsByTagName(name)[0]?.textContent?.trim() || undefined;
  const formatoTrasmissione = read("FormatoTrasmissione");
  const codiceDestinatario = read("CodiceDestinatario");
  if (!formatoTrasmissione || !codiceDestinatario) return undefined;
  return { formatoTrasmissione, codiceDestinatario };
}

registerStage("sdi-rules", async (input) => {
  const startedAt = performance.now();
  if (input.formatId !== "fatturapa") {
    return unavailable("sdi-rules", "The SDI checks only apply to FatturaPA.");
  }
  const findings: Finding[] = checkSdi(input.invoice, {
    transmission: transmissionFrom(input.xml),
  }).map((entry) => ({ source: "sdi-rules", ...entry }));
  return {
    ...settle("sdi-rules", findings, startedAt),
    note:
      "Curated from the Agenzia delle Entrate 'elenco controlli' (specs 1.9.1); " +
      `SDI publishes no Schematron for FatturaPA. ${PREDICTED_DOCUMENT_NOTE}`,
  };
});

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { fatal: 0, error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
