import type { SpecField, SpecFields, SpecUnion } from "./uapi-fields-client";
import { pointerTemplate } from "./uapi-map";

export type Coverage = {
  populated: SpecField[];
  missing: SpecField[];
  notApplicable: SpecField[];
  total: number;
  present: Set<string>;
  selected: Map<string, Set<string>>;
};

const SETTABLE = new Set(["leaf", "map"]);

function walk(node: unknown, pointer: string, into: Map<string, unknown>): void {
  into.set(pointer, node);
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${pointer}/${index}`, into));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, `${pointer}/${key}`, into);
    }
  }
}

// The payload's own discriminator values, per union axis. A CORRECTION nests the invoice under
// /data, which pointerTemplate already strips, so both operations index the same way.
function chosen(unions: SpecUnion[], present: Map<string, unknown>): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const union of unions) {
    const values = new Set<string>();
    for (const [pointer, node] of present) {
      if (pointerTemplate(pointer)?.template !== union.pointer) continue;
      const holder = node as Record<string, unknown> | null | undefined;
      const value = holder?.[union.property_name ?? "type"];
      if (typeof value === "string") values.add(value);
    }
    found.set(union.pointer, values);
  }
  return found;
}

function inScope(field: SpecField, selected: Map<string, Set<string>>): boolean {
  for (const [axis, allowed] of Object.entries(field.variants)) {
    const observed = selected.get(axis);
    // An axis the payload has not reached at all leaves every branch equally plausible.
    if (!observed || observed.size === 0) continue;
    if (!allowed.some((value) => observed.has(value))) return false;
  }
  return true;
}

export function coverage(spec: SpecFields, operation: unknown, profile: string | null): Coverage {
  const present = new Map<string, unknown>();
  walk(operation, "", present);
  const templates = new Set<string>();
  for (const [pointer, value] of present.entries()) {
    if (pointer === "" || value === undefined) continue;
    const templated = pointerTemplate(pointer);
    if (templated) templates.add(templated.template);
  }
  const selected = chosen(spec.unions, present);
  const populated: SpecField[] = [];
  const missing: SpecField[] = [];
  const notApplicable: SpecField[] = [];
  for (const field of spec.fields) {
    if (!SETTABLE.has(field.kind) || !inScope(field, selected)) continue;
    const verdict = profile ? field.applicability[profile] : undefined;
    if (verdict && verdict.status !== "applicable") {
      notApplicable.push(field);
      continue;
    }
    if (templates.has(field.pointer)) populated.push(field);
    else missing.push(field);
  }
  return {
    populated,
    missing,
    notApplicable,
    total: populated.length + missing.length,
    present: templates,
    selected,
  };
}

// An insertion crosses `{i}` only where an array member already exists: the writer refuses to
// grow an array, so offering such a field would produce a button that silently does nothing.
export function reachable(operation: unknown, pointer: string): boolean {
  let node = operation;
  let synthetic = false;
  for (const segment of pointer.split("/").slice(1)) {
    if (segment === "{i}") {
      if (synthetic || !Array.isArray(node) || node[0] === undefined) return false;
      node = node[0];
      continue;
    }
    if (synthetic) continue;
    if (node === null || typeof node !== "object" || Array.isArray(node)) return false;
    const holder = node as Record<string, unknown>;
    if (holder[segment] === undefined) synthetic = true;
    else node = holder[segment];
  }
  return true;
}

// Curated values beat the spec's own examples where the spec only illustrates a shape. The
// extractor already suppresses its generic base-type placeholders, so anything that survives is
// safe to insert; an enum falls back to its first member.
export function suggestedValue(field: SpecField): unknown {
  if (field.example !== null && field.example !== undefined) return field.example;
  const values = field.constraints.enum;
  if (Array.isArray(values) && values.length > 0) return values[0];
  const fallback = field.constraints.default;
  return fallback === undefined ? undefined : fallback;
}

// Inserting a leaf inside an absent optional object creates that object, so every sibling the
// schema requires has to arrive with it or the contract check fails on the very next render.
export function companions(spec: SpecFields, field: SpecField, coverageOf: Coverage): SpecField[] {
  if (!field.optional_ancestor) return [];
  return spec.fields.filter(
    (candidate) =>
      candidate !== field &&
      candidate.required &&
      SETTABLE.has(candidate.kind) &&
      candidate.optional_ancestor === field.optional_ancestor &&
      !coverageOf.present.has(candidate.pointer) &&
      inScope(candidate, coverageOf.selected) &&
      suggestedValue(candidate) !== undefined,
  );
}

// Why a field cannot be offered, or null when it can. Three things make an insertion unsafe:
// the array it lives in has no member, the branch it belongs to has not been chosen (offering
// one would mix `oneOf` arms), or the optional block it would create has a required sibling we
// cannot fill — each of which produces a payload the contract check rejects.
export function insertBlocker(
  spec: SpecFields,
  field: SpecField,
  coverageOf: Coverage,
  operation: unknown,
): string | null {
  if (!reachable(operation, field.pointer)) return "needs its parent entry first";
  for (const axis of Object.keys(field.variants)) {
    const observed = coverageOf.selected.get(axis);
    if (!observed || observed.size === 0) return "choose the variant in the JSON first";
  }
  if (!field.optional_ancestor) return null;
  const required = spec.fields.filter(
    (candidate) =>
      candidate !== field &&
      candidate.required &&
      candidate.optional_ancestor === field.optional_ancestor &&
      !coverageOf.present.has(candidate.pointer) &&
      inScope(candidate, coverageOf.selected),
  );
  for (const sibling of required) {
    if (!SETTABLE.has(sibling.kind)) return `${sibling.pointer} has to be built by hand first`;
    if (suggestedValue(sibling) === undefined) {
      return `${sibling.pointer} is required and the spec gives no example`;
    }
  }
  return null;
}
