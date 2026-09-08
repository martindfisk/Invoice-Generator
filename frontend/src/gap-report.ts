// A whole-invoice gap report: every field that has no home in one of the three structures the
// Mapper shows, with where it belongs and why. This is a pure fold over data that already exists —
// the registry, the BT catalogue, the mapping tables, the declared loss tables, the captured fate
// evidence and the fiskaly spec inventory. It authors no compliance prose of its own; every
// `reason` is quoted verbatim from a declared table so `make gap-check` can prove it was not
// paraphrased. Nothing in the app imports this; the generator script and its tests do.
import { allFields, catalogEntry, formatCarries, genericField } from "./field-registry";
import { getFormat } from "./formats";
import type { FieldId, FormatId } from "./model";
import { PRESET_IDS, preset, type PresetId } from "./presets";
import { fieldPresence } from "./field-presence";
import { fateFor } from "./uapi-field-fate";
import type { SpecFields } from "./uapi-fields-client";
import { coverage } from "./uapi-fields";
import { lostFields, unmatchedFields } from "./transmittable";
import {
  ACCOUNT_SUPPLIED_FIELDS,
  UAPI_DERIVED_PATHS,
  UAPI_LOSSY_FIELDS,
  UAPI_PARTIAL_FIELDS,
  SAME_DATUM,
  UAPI_POINTER_FIELDS,
  fieldForPointer,
  pointerTemplate,
} from "./uapi-map";
import { buildOperation, indexJson, pointerForField, stringifyOperation } from "./uapi-json";
import { buildFieldIndex } from "./xml-locate";

export type MissingFrom = "model" | "json" | "xml";
export type GapSeverity = "blocking" | "should-fix" | "note";
export type Country = "IT" | "BE" | "DE";

export type GapRow = {
  id: string;
  field: string;
  bt: string | null;
  bg: string | null;
  term: string | null;
  cardinality: string | null;
  format: FormatId;
  missingFrom: MissingFrom;
  belongsAt: string;
  presentIn: string;
  reason: string;
  evidence: string | null;
  applicability: string | null;
  severity: GapSeverity;
  source: string;
};

export type SpecSnapshot = { country: Country; format: FormatId; spec: SpecFields };

// The operation each country actually files, used to decide which `oneOf` branches are in scope.
// Without it every branch we never send — CONSUMER recipients, VOUCHER payments, GROUP entries —
// is reported as an unmodelled field, which is one design decision repeated a hundred times.
const SHAPE: Record<Country, PresetId> = {
  IT: "it-b2b-sdi",
  BE: "be-peppol",
  DE: "de-hotel-b2g-xrechnung",
};

// Scope: each country's mandated syntax only. Cross-format gaps stay computable but are not filed,
// because a gap in a syntax that country never files is not work anybody should pick up.
// Syntaxes that profile EN 16931, and are therefore bound by its cardinality. FatturaPA is a
// national format defined by the Agenzia delle Entrate, not a CIUS, so it is deliberately absent.
const CIUS_OF_EN16931: FormatId[] = ["ubl", "xrechnung", "cii"];

export const MANDATED: { country: Country; format: FormatId }[] = [
  { country: "IT", format: "fatturapa" },
  { country: "BE", format: "ubl" },
  { country: "DE", format: "xrechnung" },
  { country: "DE", format: "cii" },
];

export const CSV_COLUMNS = [
  "summary",
  "id",
  "field",
  "bt",
  "bg",
  "term",
  "cardinality",
  "format",
  "missingFrom",
  "belongsAt",
  "presentIn",
  "reason",
  "evidence",
  "applicability",
  "severity",
  "source",
] as const;

export const GAP_INPUTS = [
  "frontend/src/field-registry.ts",
  "frontend/src/bt-catalog.json",
  "frontend/src/uapi-map.ts",
  "frontend/src/uapi-field-fate.ts",
  "frontend/src/fatturapa-map.ts",
  "frontend/src/ubl-map.ts",
  "frontend/src/cii-map.ts",
  "frontend/src/xrechnung-map.ts",
  "spec/ (via tools/spec_fields.py)",
] as const;

// The one 2026-08-25 capture speaks for the FatturaPA path only. Saying nothing for the other three
// syntaxes would read as "not rendered"; absence of evidence is not evidence of absence.
function unobserved(label: string): string {
  return `Unobserved: no transmission capture exists for ${label}; the evidence in docs/reference/fatturapa/ covers the FatturaPA path only.`;
}

function declaredReason(field: FieldId): { reason: string; source: string } | undefined {
  const generic = genericField(field);
  for (const [reason, fields] of Object.entries(UAPI_LOSSY_FIELDS)) {
    if (fields.includes(field) || fields.includes(generic)) {
      return { reason, source: "uapi-map.UAPI_LOSSY_FIELDS" };
    }
  }
  for (const [reason, fields] of Object.entries(UAPI_PARTIAL_FIELDS)) {
    if (fields.includes(field) || fields.includes(generic)) {
      return { reason, source: "uapi-map.UAPI_PARTIAL_FIELDS" };
    }
  }
  return undefined;
}

const NO_POINTER = "The operation has no pointer for this field";
const NO_ELEMENT = "The format's mapping table carries no row for this field";
const NO_MODEL_FIELD = "The operation accepts this pointer but no model field addresses it";

function catalogue(bt: string | null) {
  const entry = bt ? catalogEntry(bt) : undefined;
  return {
    bg: entry?.group ?? null,
    term: entry?.name ?? null,
    cardinality: entry?.cardinality ?? null,
  };
}

// Mandatory in EN 16931 terms: the BT's own cardinality starts at 1.
function mandatory(cardinality: string | null): boolean {
  return typeof cardinality === "string" && cardinality.trimStart().startsWith("1");
}

/**
 * Severity is derived, and each rule is one sentence a reviewer can dispute.
 *
 * R1 blocking — a term the standard makes mandatory that the mandated syntax renders no element
 *   for. Nothing downstream can supply it, so a filing is at risk. Only syntaxes that are a CIUS
 *   of EN 16931 can breach it: FatturaPA is a national format, not a CIUS, so EN cardinality does
 *   not bind it and a term it simply has no place for is a property of the format, not a defect.
 * R2 should-fix — the syntax renders it but the operation cannot carry it, so data the user
 *   authored never reaches fiskaly and its document will differ from our prediction; also a spec
 *   pointer the API requires that no model field addresses.
 * R3 note — optional, not applicable for the profile, or platform-supplied.
 * R4 platform — the captured evidence says fiskaly fills this from the Taxpayer or derives it, so
 *   its absence from the payload is by design, whatever the BT's cardinality says.
 *
 * A mandatory BT missing from the *operation* is deliberately not blocking: fiskaly derives BT-3
 * and takes the seller from the commissioned Taxpayer, and calling those blocking buried the seven
 * rows that genuinely are under forty that are not.
 */
function severityFor(input: {
  missingFrom: MissingFrom;
  cardinality: string | null;
  required: boolean;
  applicable: boolean;
  carriedInXml: boolean;
  platform: boolean;
  bindsEn16931: boolean;
}): { severity: GapSeverity; rule: string } {
  if (!input.applicable) return { severity: "note", rule: "R3" };
  if (input.platform) return { severity: "note", rule: "R4" };
  if (input.missingFrom === "xml" && mandatory(input.cardinality) && input.bindsEn16931) {
    return { severity: "blocking", rule: "R1" };
  }
  if (input.missingFrom === "json" && input.carriedInXml) {
    return { severity: "should-fix", rule: "R2" };
  }
  if (input.missingFrom === "model" && input.required) {
    return { severity: "should-fix", rule: "R2" };
  }
  return { severity: "note", rule: "R3" };
}

function presentInText(parts: { structure: string; address: string | null }[]): string {
  return parts.map((part) => `${part.structure} ${part.address ?? "—"}`).join("; ");
}

function specFor(snapshots: SpecSnapshot[], format: FormatId): SpecSnapshot | undefined {
  return snapshots.find((snapshot) => snapshot.format === format);
}

function applicabilityOf(snapshot: SpecSnapshot | undefined, pointer: string | undefined) {
  if (!snapshot || !pointer)
    return { text: null as string | null, applicable: true, required: false };
  const profile = snapshot.spec.profile;
  const row = snapshot.spec.fields.find((entry) => entry.pointer === pointer);
  if (!row) return { text: null, applicable: true, required: false };
  const verdict = profile ? row.applicability[profile] : undefined;
  return {
    text: verdict ? `${profile}: ${verdict.status}` : null,
    applicable: verdict === undefined || verdict.status === "applicable",
    required: row.required,
  };
}

/**
 * Direction A — model fields with no home in the mandated syntax or in the operation.
 *
 * Static by construction: `formatCarries` and `pointerForField` need no invoice, so a row here is a
 * structural claim, not an artefact of one preset. A field missing from both structures yields the
 * `xml` row only — the JSON gap is moot for a syntax that renders no element — with the rest
 * recorded in `presentIn`.
 */
export function modelGaps(snapshots: SpecSnapshot[] = []): GapRow[] {
  const rows: GapRow[] = [];
  for (const { format } of MANDATED) {
    const plugin = getFormat(format);
    const snapshot = specFor(snapshots, format);
    for (const spec of allFields()) {
      const field = spec.field;
      // A field whose datum another spelling already writes is not missing from the syntax.
      const carried =
        formatCarries(format, field) ||
        (SAME_DATUM[field] ?? []).some((alias) => formatCarries(format, alias as FieldId));
      const concrete = pointerForField(field, "");
      const pointer = concrete ? (pointerTemplate(concrete)?.template ?? concrete) : undefined;
      const declared = declaredReason(field);
      // The same aliasing applies to the operation: BT-49 travels as recipients[].invoicing and
      // BT-120 as the line-level vat.reason, so a spelling whose alias the JSON fully carries is
      // not a JSON gap either — reporting it was refuted by the 2026-09 gap audit
      // (docs/gaps/verdicts.json: the NO_POINTER fallback asserted a contract fact that is false).
      const aliasInJson = (alias: FieldId) =>
        pointerForField(alias, "") !== undefined && declaredReason(alias) === undefined;
      const inJson =
        (pointer !== undefined && declared === undefined) ||
        (SAME_DATUM[field] ?? []).some((alias) => aliasInJson(alias as FieldId));
      if (carried && inJson) continue;

      const missingFrom: MissingFrom = carried ? "json" : "xml";
      const bt = spec.bt ?? null;
      const { bg, term, cardinality } = catalogue(bt);
      const { text: applicability, applicable, required } = applicabilityOf(snapshot, pointer);
      const fate = pointer ? fateFor(format, pointer) : undefined;
      // The datum is provided — mastered on an account resource (Taxpayer, System) and derived
      // per invoice by fiskaly — so its absence from the operation is by design (R4), not loss.
      const accountSource =
        missingFrom === "json" ? ACCOUNT_SUPPLIED_FIELDS[genericField(field)] : undefined;
      const { severity, rule } = severityFor({
        missingFrom,
        cardinality,
        required,
        applicable,
        carriedInXml: carried,
        platform: fate?.fate === "platform" || accountSource !== undefined,
        bindsEn16931: CIUS_OF_EN16931.includes(format),
      });
      const reason = missingFrom === "xml" ? NO_ELEMENT : (declared?.reason ?? NO_POINTER);
      const source =
        missingFrom === "xml"
          ? `structural · ${format}-map.ts · ${rule}`
          : `structural · ${declared?.source ?? "gap-report.ts"} · ${rule}`;
      const evidence = accountSource
        ? `Derived: fiskaly fills this from ${accountSource} — provided when the account is ` +
          "onboarded (POST /taxpayers, system commissioning), not per invoice."
        : format === "fatturapa"
          ? fate
            ? `${fate.fate}: ${fate.note}`
            : null
          : unobserved(plugin.label);

      rows.push({
        id: `${format}|${field}|${missingFrom}`,
        field,
        bt,
        bg,
        term,
        cardinality,
        format,
        missingFrom,
        // The address that is missing is exactly what does not exist. Where a pointer is known —
        // a partial carry — name it; otherwise the business term is the semantic address, and
        // proposing the syntax binding is the work the ticket asks for. An account-supplied
        // field keeps the BT here (a vocabulary gap-check can verify) and names the Taxpayer/
        // System property that masters it in `evidence`.
        belongsAt: missingFrom === "json" && pointer ? pointer : (bt ?? field),
        presentIn: presentInText([
          { structure: "model", address: bt ?? spec.label },
          { structure: "json", address: inJson ? (pointer ?? null) : null },
          { structure: "xml", address: carried ? "mapped" : null },
        ]),
        reason,
        evidence,
        applicability,
        severity,
        source,
      });
    }
  }
  return rows;
}

/**
 * Direction B — pointers the fiskaly operation accepts that no model field addresses. These are
 * `CoveragePanel`'s *orphans*: a different piece of work from a missing XML binding, so they get
 * their own `missingFrom`.
 *
 * One row per pointer, not one per format. The claim "the API accepts this and we do not model it"
 * is a property of the operation, so emitting it once per mandated syntax quadrupled a single fact.
 * Scope comes from `coverage()`, which filters to the union branches the country's own invoice
 * selects, and the countries a pointer applies to are named in `applicability`.
 */
export function specGaps(snapshots: SpecSnapshot[]): GapRow[] {
  const derived = new Set(UAPI_DERIVED_PATHS);
  const claimed = new Set(Object.keys(UAPI_POINTER_FIELDS));
  const found = new Map<string, { row: GapRow; where: string[] }>();

  for (const snapshot of snapshots) {
    const { country, format, spec } = snapshot;
    const invoice = preset(SHAPE[country]);
    const operation = buildOperation(invoice).value;
    for (const entry of coverage(spec, operation, spec.profile).missing) {
      if (claimed.has(entry.pointer) || derived.has(entry.pointer)) continue;
      if (fieldForPointer(entry.pointer) !== undefined) continue;
      const verdict = spec.profile ? entry.applicability[spec.profile] : undefined;
      const seen = found.get(entry.pointer);
      const where = `${spec.profile}: ${verdict?.status ?? "applicable"}`;
      if (seen) {
        if (!seen.where.includes(where)) seen.where.push(where);
        continue;
      }
      const bt = entry.bt[0] ?? null;
      const { bg, term, cardinality } = catalogue(bt);
      const fate = fateFor(format, entry.pointer);
      const { severity, rule } = severityFor({
        missingFrom: "model",
        cardinality,
        required: entry.required,
        applicable: true,
        carriedInXml: false,
        platform: fate?.fate === "platform",
        bindsEn16931: CIUS_OF_EN16931.includes(format),
      });
      found.set(entry.pointer, {
        where: [where],
        row: {
          id: `operation|${entry.pointer}|model`,
          field: "",
          bt,
          bg,
          term,
          cardinality,
          format,
          missingFrom: "model",
          belongsAt: entry.pointer,
          presentIn: presentInText([
            { structure: "model", address: null },
            { structure: "json", address: entry.pointer },
            { structure: "xml", address: null },
          ]),
          reason: NO_MODEL_FIELD,
          evidence: fate ? `${fate.fate}: ${fate.note}` : null,
          applicability: null,
          severity,
          source: `spec · ${spec.source} · ${rule}`,
        },
      });
    }
  }
  return [...found.values()].map(({ row, where }) => ({ ...row, applicability: where.join("; ") }));
}

const ORDER: MissingFrom[] = ["model", "json", "xml"];

export function gapRows(snapshots: SpecSnapshot[] = []): GapRow[] {
  const seen = new Set<string>();
  const rows = [...modelGaps(snapshots), ...specGaps(snapshots)].filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  return rows.sort((a, b) => {
    if (a.format !== b.format) return a.format.localeCompare(b.format);
    const order = ORDER.indexOf(a.missingFrom) - ORDER.indexOf(b.missingFrom);
    return order !== 0 ? order : a.id.localeCompare(b.id);
  });
}

export function gapSummary(rows: GapRow[]) {
  const tally = (pick: (row: GapRow) => string) =>
    rows.reduce<Record<string, number>>((into, row) => {
      const key = pick(row);
      into[key] = (into[key] ?? 0) + 1;
      return into;
    }, {});
  return {
    total: rows.length,
    byFormat: tally((row) => row.format),
    byMissingFrom: tally((row) => row.missingFrom),
    bySeverity: tally((row) => row.severity),
    byEvidence: tally((row) =>
      row.evidence === null
        ? "none"
        : row.evidence.startsWith("Unobserved")
          ? "unobserved"
          : "captured",
    ),
    causes: new Set(rows.map((row) => row.reason)).size,
    excludedDerivedPaths: UAPI_DERIVED_PATHS.length,
  };
}

/**
 * The static verdict is an approximation of what the Mapper shows for a real invoice. This runs the
 * live `fieldPresence` over every preset and reports where the two disagree, so the approximation
 * failing is a visible finding rather than a quietly wrong row.
 */
export function presetContradictions(
  rows: GapRow[],
): { id: string; preset: string; note: string }[] {
  const found: { id: string; preset: string; note: string }[] = [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of PRESET_IDS) {
    const invoice = preset(id);
    const format = getFormat(invoice.format);
    const operation = buildOperation(invoice);
    const input = {
      invoice,
      format,
      fields: buildFieldIndex(invoice, format.map),
      jsonIndex: indexJson(stringifyOperation(operation.value)),
      jsonPrefix: operation.prefix,
    };
    for (const spec of allFields()) {
      const row = byId.get(`${format.id}|${spec.field}|xml`);
      if (!row) continue;
      const live = fieldPresence(spec.field, input).find((entry) => entry.structure === "xml");
      if (live?.present) {
        found.push({
          id: row.id,
          preset: id,
          note: "the report calls this an XML gap but the live index resolves a path",
        });
      }
    }
  }
  return found;
}

function cell(value: string | null): string {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function summaryOf(row: GapRow): string {
  return `${row.format} · ${row.field || row.belongsAt} missing from ${row.missingFrom}`;
}

export function toCsv(rows: GapRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((column) =>
        cell(
          column === "summary"
            ? summaryOf(row)
            : ((row[column as keyof GapRow] ?? null) as string | null),
        ),
      ).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export type UnmatchedRow = {
  format: FormatId;
  field: string;
  bt: string | null;
  term: string | null;
  why: string;
};

/**
 * Fields the syntax renders where nothing tells us whether the operation delivers them or fiskaly
 * fills them in. They stay in the predicted XML — absence of evidence is not evidence of absence —
 * and are listed here so the question gets settled rather than guessed at.
 */
export function unmatchedRows(): UnmatchedRow[] {
  const rows: UnmatchedRow[] = [];
  const seen = new Set<string>();
  for (const { country, format } of MANDATED) {
    const invoice = preset(SHAPE[country]);
    for (const entry of unmatchedFields(invoice, format)) {
      const key = `${format}|${entry.field}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const spec = allFields().find((candidate) => candidate.field === genericField(entry.field));
      const bt = spec?.bt ?? null;
      rows.push({ format, field: entry.field, bt, term: catalogue(bt).term, why: entry.why });
    }
  }
  return rows.sort((a, b) => a.format.localeCompare(b.format) || a.field.localeCompare(b.field));
}

/** Fields the prediction drops because nothing can deliver them. */
export function suppressedRows(): UnmatchedRow[] {
  const rows: UnmatchedRow[] = [];
  for (const { country, format } of MANDATED) {
    const invoice = preset(SHAPE[country]);
    for (const field of lostFields(invoice, format)) {
      const spec = allFields().find((candidate) => candidate.field === genericField(field));
      const bt = spec?.bt ?? null;
      rows.push({ format, field, bt, term: catalogue(bt).term, why: "nothing delivers it" });
    }
  }
  return rows.sort((a, b) => a.format.localeCompare(b.format) || a.field.localeCompare(b.field));
}

// Dumped alongside the report so the Python checks assert against the same truths rather than
// re-implementing TypeScript and drifting.
export function gapInputs() {
  return {
    modelFields: allFields().map((spec) => spec.field),
    pointerFields: UAPI_POINTER_FIELDS,
    derivedPaths: UAPI_DERIVED_PATHS,
    declaredReasons: {
      "uapi-map.UAPI_LOSSY_FIELDS": Object.keys(UAPI_LOSSY_FIELDS),
      "uapi-map.UAPI_PARTIAL_FIELDS": Object.keys(UAPI_PARTIAL_FIELDS),
      "gap-report.ts": [NO_ELEMENT, NO_POINTER, NO_MODEL_FIELD],
    },
    mappingPaths: Object.fromEntries(
      MANDATED.map(({ format }) => [
        format,
        getFormat(format).map.map((row) => ({
          field: row.field,
          path: row.path,
          bt: row.bt ?? null,
          fpa: row.fpa ?? null,
        })),
      ]),
    ),
  };
}
