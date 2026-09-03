// What the predicted XML should actually show.
//
// The writers render everything the model holds. fiskaly renders what the operation carries, plus
// what it supplies itself. Those differ, and where they differ the prediction is wrong: an element
// built from a field the payload cannot carry will not be in the transmitted document, so showing
// it invites a diff that looks like a fiskaly bug and is ours.
//
// Not every uncarried field is lost. fiskaly derives BT-3, takes the seller from the commissioned
// Taxpayer, recomputes the VAT summary and defaults the payment method — those elements appear.
// LOSS_KIND in uapi-map.ts records which is which; anything it cannot classify is left rendered
// and reported, never silently dropped.
import { allFields, formatCarries, genericField } from "./field-registry";
import type { FieldId, FormatId, Invoice } from "./model";
import { getField, setField } from "./model";
import { LOSS_KIND, type LossKind } from "./uapi-map";
import { lossyGroups, partialGroups, pointerForField } from "./uapi-json";

export type Carriage = "carried" | LossKind;

export type Unmatched = {
  field: FieldId;
  carriage: Exclude<Carriage, "carried" | "lost" | "platform">;
  why: string;
};

function groupsOf(invoice: Invoice, kind: LossKind): FieldId[] {
  return lossyGroups(invoice)
    .filter((group) => LOSS_KIND[group.reason] === kind)
    .flatMap((group) => group.fields);
}

/** Fields the chosen syntax renders but the operation provably never delivers. */
export function lostFields(invoice: Invoice, formatId: FormatId): FieldId[] {
  return groupsOf(invoice, "lost").filter((field) => formatCarries(formatId, field));
}

/**
 * The invoice as fiskaly will receive it: the same document with the fields nothing can deliver
 * blanked, so the predicted XML omits exactly the elements the transmitted one will not have.
 */
export function transmittable(invoice: Invoice, formatId: FormatId): Invoice {
  const stripped = lostFields(invoice, formatId).reduce(
    (into, field) => setField(into, field, undefined),
    invoice,
  );
  return prune(stripped) as Invoice;
}

/**
 * Drop containers left empty by the blanking. Clearing both halves of `it.bollo` leaves the object
 * itself in place, and a writer that tests for the block then formats an absent amount throws —
 * so an emptied container has to go with its contents.
 */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value === null || typeof value !== "object") return value;
  const kept: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const pruned = prune(item);
    if (pruned !== undefined) kept[key] = pruned;
  }
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/**
 * Fields this syntax renders where we cannot say whether the operation delivers them or fiskaly
 * fills them in. They stay in the prediction — absence of evidence is not evidence of absence —
 * and are listed so a reviewer can settle them.
 */
export function unmatchedFields(invoice: Invoice, formatId: FormatId): Unmatched[] {
  const found = new Map<FieldId, Unmatched>();
  const add = (field: FieldId, carriage: Unmatched["carriage"], why: string) => {
    if (!formatCarries(formatId, field) || found.has(field)) return;
    // Only fields this invoice actually renders: an unset optional field produces no element, so
    // whether the operation could carry it is not a question this document raises.
    const value = getField(invoice, field);
    if (value === undefined || value === null || value === "") return;
    found.set(field, { field, carriage, why });
  };

  for (const group of lossyGroups(invoice)) {
    if (LOSS_KIND[group.reason] !== "unknown") continue;
    for (const field of group.fields) add(field, "unknown", group.reason);
  }
  for (const group of partialGroups(invoice)) {
    for (const field of group.fields) add(field, "unknown", group.reason);
  }
  // Rendered by the syntax, addressed by no pointer, and explained by no table: the residue that
  // nobody has decided about yet. A field a `platform` reason already accounts for is not part of
  // it — fiskaly supplies those, which is an answer, not a gap.
  const explained = new Set(
    [...lossyGroups(invoice), ...partialGroups(invoice)].flatMap((group) => group.fields),
  );
  for (const spec of allFields()) {
    if (pointerForField(spec.field, "") !== undefined) continue;
    if (explained.has(spec.field) || explained.has(genericField(spec.field))) continue;
    add(spec.field, "unknown", "no pointer in the operation and no declared reason");
  }
  return [...found.values()].sort((a, b) => a.field.localeCompare(b.field));
}

export function carriageOf(field: FieldId, invoice: Invoice): Carriage {
  for (const group of lossyGroups(invoice)) {
    if (group.fields.includes(field)) return LOSS_KIND[group.reason] ?? "unknown";
  }
  if (partialGroups(invoice).some((group) => group.fields.includes(field))) return "unknown";
  return pointerForField(field, "") === undefined ? "unknown" : "carried";
}
