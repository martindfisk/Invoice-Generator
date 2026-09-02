import { fateEntry, fateLabel } from "./field-fate";
import { genericField } from "./field-registry";
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

export function fieldPresence(field: FieldId, input: PresenceInput): FieldPresence[] {
  const { invoice, format, fields, jsonIndex, jsonPrefix } = input;
  const entry = fields.entry(field);
  const declaredReasons = reasons(invoice);

  const inHuman = entry.rows.length > 0;
  const human: FieldPresence = {
    structure: "human",
    label: "Fields",
    present: inHuman,
    detail: inHuman ? (entry.bt ?? entry.label ?? field) : field,
    reason: inHuman ? undefined : `${format.label} does not carry this business term`,
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
