import { genericField } from "./field-registry";
import { getField, type FieldId, type Invoice } from "./model";
import {
  fieldForPointer as fieldForOperationPointer,
  fromInvoiceTransaction,
  isCorrection,
  toCorrectionTransaction,
  toInvoiceTransaction,
  UAPI_LOSSY_FIELDS,
  UAPI_PARTIAL_FIELDS,
  UAPI_POINTER_FIELDS,
  type UapiOperation,
} from "./uapi-map";

// The Unified API accepts a structured JSON operation, not XML — fiskaly generates the
// transmitted document server-side. This module addresses that operation for the UI: JSON
// Pointer ranges for cross-highlighting, and the lossiness uapi-map.ts documents.

export const OPERATION_PRIMARY_NOTE =
  "The Unified API accepts this JSON, not XML. It is the artifact you author and Send posts " +
  "unchanged; fiskaly generates the transmitted XML from it.";

export const CORRECTION_PENDING_NOTE =
  "This is a credit note. Send wraps it in a TRANSACTION::CORRECTION that references the record " +
  "id of the invoice being corrected, and that id only exists once the original has been sent. " +
  "Until then this pane shows the TRANSACTION::INVOICE body the correction will carry as its " +
  "`data` block.";

export const CORRECTION_BLOCKED_NOTE =
  "This credit note needs the record id of the invoice it corrects, and no invoice has been " +
  "transmitted from this browser yet. Send the original invoice first — the credit note can " +
  "then reference that record.";

export const CONTRACT_STAGE = "uapi-schema";

export function isContractStage(id: string): boolean {
  return id === CONTRACT_STAGE;
}

export const CONTRACT_TIER_NOTE =
  "Does the Unified API accept the JSON you composed? This is the only stage that speaks about " +
  "the payload Send actually posts.";

export const DOCUMENT_TIER_NOTE =
  "What the resulting XML would look like — this browser's predicted document checked against " +
  "the format's own rules. A pass here is not fiskaly accepting anything.";

export type JsonRange = { pointer: string; from: number; to: number };

export type JsonIndex = { ranges: JsonRange[]; byPointer: Map<string, JsonRange> };

export const EMPTY_JSON_INDEX: JsonIndex = { ranges: [], byPointer: new Map() };

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const LITERAL = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/;

function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function scanJson(text: string): JsonRange[] {
  const ranges: JsonRange[] = [];
  let at = 0;

  const fail: () => never = () => {
    throw new Error(`uapi-json: unparseable at offset ${at}`);
  };

  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at += 1;
  };

  const string = (): string => {
    if (text[at] !== '"') fail();
    at += 1;
    let out = "";
    while (at < text.length) {
      const char = text[at];
      if (char === '"') {
        at += 1;
        return out;
      }
      if (char === "\\") {
        const escape = text[at + 1];
        at += 2;
        if (escape === "u") {
          out += String.fromCharCode(Number.parseInt(text.slice(at, at + 4), 16));
          at += 4;
        } else {
          out += ESCAPES[escape] ?? escape;
        }
        continue;
      }
      out += char;
      at += 1;
    }
    return fail();
  };

  const value = (pointer: string, keyStart: number): void => {
    space();
    const start = at;
    const char = text[at];
    if (char === "{") {
      at += 1;
      object(pointer);
    } else if (char === "[") {
      at += 1;
      array(pointer);
    } else if (char === '"') {
      string();
    } else {
      const literal = LITERAL.exec(text.slice(at));
      if (!literal) fail();
      at += literal[0].length;
    }
    ranges.push({ pointer, from: keyStart === -1 ? start : keyStart, to: at });
  };

  const object = (pointer: string): void => {
    space();
    if (text[at] === "}") {
      at += 1;
      return;
    }
    for (;;) {
      space();
      const keyStart = at;
      const key = string();
      space();
      if (text[at] !== ":") fail();
      at += 1;
      value(`${pointer}/${escapeToken(key)}`, keyStart);
      space();
      if (text[at] === ",") {
        at += 1;
        continue;
      }
      if (text[at] === "}") {
        at += 1;
        return;
      }
      fail();
    }
  };

  const array = (pointer: string): void => {
    space();
    if (text[at] === "]") {
      at += 1;
      return;
    }
    let index = 0;
    for (;;) {
      value(`${pointer}/${index}`, -1);
      index += 1;
      space();
      if (text[at] === ",") {
        at += 1;
        continue;
      }
      if (text[at] === "]") {
        at += 1;
        return;
      }
      fail();
    }
  };

  value("", -1);
  space();
  if (at !== text.length) fail();
  return ranges;
}

export function indexJson(text: string): JsonIndex {
  if (text.trim() === "") return EMPTY_JSON_INDEX;
  let ranges: JsonRange[];
  try {
    ranges = scanJson(text);
  } catch {
    return EMPTY_JSON_INDEX;
  }
  const byPointer = new Map<string, JsonRange>();
  for (const range of ranges) byPointer.set(range.pointer, range);
  return { ranges, byPointer };
}

export function pointerRange(index: JsonIndex, pointer: string | undefined): JsonRange | undefined {
  if (!pointer) return undefined;
  const exact = index.byPointer.get(pointer);
  if (exact) return exact;
  // A finding may point at a member the payload never wrote; fall back to its closest ancestor
  // so the reader is still taken to the right neighbourhood instead of nowhere.
  let candidate = pointer;
  while (candidate.length > 0) {
    candidate = candidate.slice(0, candidate.lastIndexOf("/"));
    const found = index.byPointer.get(candidate);
    if (found) return found;
  }
  return index.byPointer.get("");
}

export function pointerAtOffset(index: JsonIndex, offset: number): string | undefined {
  for (const range of index.ranges) {
    if (offset >= range.from && offset <= range.to) return range.pointer;
  }
  return undefined;
}

const POINTER_BY_FIELD = new Map<FieldId, string>(
  Object.entries(UAPI_POINTER_FIELDS).map(([pointer, field]): [FieldId, string] => [
    field,
    pointer,
  ]),
);

export function pointerForField(field: FieldId, prefix = ""): string | undefined {
  const template = POINTER_BY_FIELD.get(genericField(field));
  if (!template) return undefined;
  if (!template.includes("{i}")) return `${prefix}${template}`;
  // recipients and payments are single-element collections the model has no index for.
  const index = /\.(\d+)(?=\.|$)/.exec(field)?.[1] ?? "0";
  return `${prefix}${template.replace("{i}", index)}`;
}

export function fieldForPointer(pointer: string, prefix = ""): FieldId | undefined {
  const rest = prefix && pointer.startsWith(prefix) ? pointer.slice(prefix.length) : pointer;
  for (let candidate = rest; candidate.startsWith("/");) {
    const field = fieldForOperationPointer(candidate);
    if (field) return field;
    candidate = candidate.slice(0, candidate.lastIndexOf("/"));
  }
  return undefined;
}

export type LossyGroup = { reason: string; fields: FieldId[] };

function expand(field: FieldId, invoice: Invoice): FieldId[] {
  if (!field.includes("{i}")) return [field];
  const collection = field.startsWith("lines.") ? invoice.lines : invoice.vatBreakdown;
  return collection.map((_, index) => field.replace("{i}", String(index)));
}

function present(field: FieldId, invoice: Invoice): boolean {
  const value = getField(invoice, field);
  return value !== undefined && value !== null && value !== "";
}

// The set uapi-map.ts documents, narrowed to the values this invoice actually holds — so the
// warning names what would really be lost rather than everything that could ever be.
function groupsFrom(source: Record<string, FieldId[]>, invoice: Invoice): LossyGroup[] {
  return Object.entries(source)
    .map(([reason, fields]) => ({
      reason,
      fields: fields.flatMap((field) => expand(field, invoice)).filter((f) => present(f, invoice)),
    }))
    .filter((group) => group.fields.length > 0);
}

export function lossyGroups(invoice: Invoice): LossyGroup[] {
  return groupsFrom(UAPI_LOSSY_FIELDS, invoice);
}

export function partialGroups(invoice: Invoice): LossyGroup[] {
  return groupsFrom(UAPI_PARTIAL_FIELDS, invoice);
}

export type Operation = {
  value: unknown;
  error: string | null;
  correctionPending: boolean;
  label: string;
  prefix: string;
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildOperation(invoice: Invoice, correctionRecordId?: string | null): Operation {
  const correction = isCorrection(invoice);
  try {
    if (correction && correctionRecordId) {
      return {
        value: toCorrectionTransaction(invoice, { originalRecordId: correctionRecordId }),
        error: null,
        correctionPending: false,
        label: "TRANSACTION::CORRECTION",
        prefix: "/data",
      };
    }
    return {
      value: toInvoiceTransaction(invoice),
      error: null,
      correctionPending: correction,
      label: "TRANSACTION::INVOICE",
      prefix: "",
    };
  } catch (error) {
    return {
      value: null,
      error: reason(error),
      correctionPending: correction,
      label: correction ? "TRANSACTION::CORRECTION" : "TRANSACTION::INVOICE",
      prefix: "",
    };
  }
}

export function stringifyOperation(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch (error) {
    return reason(error);
  }
}

export function applyOperation(operation: unknown, base: Invoice): Invoice {
  const held = operation as UapiOperation;
  if (held === null || typeof held !== "object") {
    throw new Error("The operation must be a JSON object.");
  }
  return { ...fromInvoiceTransaction(held, base), format: base.format };
}

// True when regenerating this pane from the model would not reproduce what the user typed —
// the same test the XML pane uses to decide whether a later field edit will drop the edit.
export function operationIsLossy(invoice: Invoice, operation: unknown, prefix: string): boolean {
  const derived = buildOperation(invoice, null);
  if (derived.error !== null) return true;
  const body = prefix === "/data" ? (operation as { data?: unknown } | null)?.data : operation;
  return JSON.stringify(body) !== JSON.stringify(derived.value);
}

// The Compose JSON is re-derived from the model whenever the user has not typed, so an insertion
// has to go back through the same text the editor holds: write the value, re-stringify, and let
// the existing editJson path parse it. Anything written anywhere else would be dropped on the
// next render. A `{i}` segment resolves to the first existing member; the pointer is left alone
// when that member does not exist, so an insert never grows an array. A refused insert returns
// the text unchanged and names why through onFail, so the button never appears to do nothing.
export function insertAtPointer(
  text: string,
  pointer: string,
  value: unknown,
  onFail?: (reason: string) => void,
): string {
  const refuse = (reason: string) => {
    onFail?.(reason);
    return text;
  };
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return refuse("the JSON pane does not parse — fix it before inserting");
  }
  const segments = pointer.split("/").slice(1);
  let node = root;
  for (let index = 0; index < segments.length; index += 1) {
    const raw = segments[index];
    const last = index === segments.length - 1;
    const key = raw === "{i}" ? "0" : raw;
    if (Array.isArray(node)) {
      const position = Number(key);
      if (!Number.isInteger(position) || node[position] === undefined) {
        return refuse(
          `${pointer} points into an array member that does not exist — an insert never grows an array`,
        );
      }
      if (last) {
        node[position] = value;
        return stringifyOperation(root);
      }
      node = node[position];
      continue;
    }
    if (raw === "{i}") {
      return refuse(`${pointer} expects an array at /${segments.slice(0, index).join("/")}`);
    }
    if (node === null || typeof node !== "object") {
      return refuse(`${pointer} points below a value that is not an object`);
    }
    const holder = node as Record<string, unknown>;
    if (last) {
      holder[key] = value;
      return stringifyOperation(root);
    }
    if (holder[key] === undefined) holder[key] = {};
    node = holder[key];
  }
  return stringifyOperation(root);
}
