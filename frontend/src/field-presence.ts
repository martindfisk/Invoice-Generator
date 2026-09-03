import { fateEntry, fateLabel } from "./field-fate";
import { allFields, genericField, type FieldSpec } from "./field-registry";
import type { FormatPlugin } from "./formats";
import type { FieldId, Invoice } from "./model";
import { lossyGroups, partialGroups, pointerForField, type JsonIndex } from "./uapi-json";
import type { FieldIndex } from "./xml-locate";

export type StructureId = "human" | "json" | "xml";

export type FieldPresence = {
  structure: StructureId;
  label: string;
  present: boolean;
  detail: string;
  reason?: string;
};

export type PresenceInput = {
  invoice: Invoice;
  format: FormatPlugin;
  fields: FieldIndex;
  jsonIndex: JsonIndex;
  jsonPrefix: string;
};

// A field can be declared uncarriable for the whole operation (lossy) or only in some shapes
// (partial). Both are already data in uapi-map.ts, so the strip quotes the same reason the
// Compose caveat does rather than inventing its own wording.
function reasons(invoice: Invoice): Map<FieldId, string> {
  const found = new Map<FieldId, string>();
  for (const group of [...lossyGroups(invoice), ...partialGroups(invoice)]) {
    for (const field of group.fields) {
      if (!found.has(field)) found.set(field, group.reason);
    }
  }
  return found;
}

function declared(map: Map<FieldId, string>, field: FieldId): string | undefined {
  return map.get(field) ?? map.get(genericField(field));
}

// Model presence comes from the registry, not from the chosen format's mapping table. Deriving it
// from the table made it identical to XML presence — MappingRow.path is non-optional and
// pathForRows() returns undefined only for zero rows — so the strip had a column that could never
// disagree with another. `it.cup` is a field this app models even when UBL renders no element.
let registry: Map<FieldId, FieldSpec> | null = null;

function modelled(field: FieldId): FieldSpec | undefined {
  if (!registry) registry = new Map(allFields().map((spec) => [spec.field, spec]));
  return registry.get(field) ?? registry.get(genericField(field));
}

export function fieldPresence(field: FieldId, input: PresenceInput): FieldPresence[] {
  const { invoice, format, fields, jsonIndex, jsonPrefix } = input;
  const entry = fields.entry(field);
  const declaredReasons = reasons(invoice);

  const spec = modelled(field);
  const human: FieldPresence = {
    structure: "human",
    label: "Fields",
    present: spec !== undefined,
    detail: spec ? (spec.bt ?? spec.label) : field,
    reason: spec
      ? undefined
      : "not part of the canonical invoice model — it rides on the fiskaly operation only",
  };

  const pointer = pointerForField(field, jsonPrefix);
  const inJson = pointer !== undefined && jsonIndex.byPointer.has(pointer);
  const fate = pointer ? fateEntry(format.id, pointer.slice(jsonPrefix.length)) : undefined;
  const json: FieldPresence = {
    structure: "json",
    label: "fiskaly JSON",
    present: inJson,
    detail: inJson ? (pointer ?? "") : (pointer ?? "no pointer in the operation"),
    reason: inJson
      ? fate && `Sent, but ${fateLabel(fate.fate).toLowerCase()} — ${fate.note}`
      : (declared(declaredReasons, field) ??
        "the TRANSACTION::INVOICE operation has no field for this"),
  };

  const inXml = entry.path !== undefined;
  const xml: FieldPresence = {
    structure: "xml",
    label: `Predicted ${format.label}`,
    present: inXml,
    detail: inXml ? (entry.path ?? "") : (entry.fpa ?? field),
    reason: inXml ? undefined : `${format.label} renders no element for this field`,
  };

  return [human, json, xml];
}

export function missingCount(presence: FieldPresence[]): number {
  return presence.filter((entry) => !entry.present).length;
}
