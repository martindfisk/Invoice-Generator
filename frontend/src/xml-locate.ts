import { xml } from "@codemirror/lang-xml";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Text } from "@codemirror/state";
import { getField, resolveField, type FieldId, type Invoice, type MappingRow } from "./model";

type Tree = ReturnType<typeof syntaxTree>;
type Node = Tree["topNode"];

export type XmlRange = { path: string; from: number; to: number };

export type XmlIndex = {
  ranges: XmlRange[];
  byPath: Map<string, XmlRange>;
};

export type FieldEntry = {
  field: FieldId;
  rows: MappingRow[];
  path?: string;
  bt?: string;
  fpa?: string;
  label?: string;
};

export type FieldIndex = {
  entry(field: FieldId): FieldEntry;
  fieldForPath(path: string): FieldId | undefined;
};

const PARSE_BUDGET_MS = 5000;

const MAX_STEPS_BELOW_ANCESTOR = 2;

export function normalisePath(path: string): string {
  return path.replace(/\[0\]/g, "").replace(/^\/+/, "");
}

function steps(path: string): string[] {
  return normalisePath(path).split("/").filter(Boolean);
}

function parentPath(path: string): string {
  const parts = steps(path);
  return parts.slice(0, -1).join("/");
}

function commonPrefix(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  const prefix: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    if (rest.some((list) => list[index] !== first[index])) break;
    prefix.push(first[index]);
  }
  return prefix;
}

function collect(parent: Node, doc: Text, base: string, out: XmlRange[]): void {
  const seen = new Map<string, number>();
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.name !== "Element") continue;
    const tag = child.firstChild;
    if (!tag || (tag.name !== "OpenTag" && tag.name !== "SelfClosingTag")) continue;
    const tagName = tag.getChild("TagName");
    if (!tagName) continue;
    const name = doc.sliceString(tagName.from, tagName.to);
    const occurrence = seen.get(name) ?? 0;
    seen.set(name, occurrence + 1);
    const path = base
      ? `${base}/${occurrence === 0 ? name : `${name}[${occurrence}]`}`
      : occurrence === 0
        ? name
        : `${name}[${occurrence}]`;
    out.push({ path, from: child.from, to: child.to });
    for (const attribute of tag.getChildren("Attribute")) {
      const attributeName = attribute.getChild("AttributeName");
      if (!attributeName) continue;
      out.push({
        path: `${path}/@${doc.sliceString(attributeName.from, attributeName.to)}`,
        from: attribute.from,
        to: attribute.to,
      });
    }
    collect(child, doc, path, out);
  }
}

export function indexXml(text: string): XmlIndex {
  const state = EditorState.create({ doc: text, extensions: [xml()] });
  const tree = ensureSyntaxTree(state, text.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const ranges: XmlRange[] = [];
  collect(tree.topNode, state.doc, "", ranges);
  const byPath = new Map<string, XmlRange>();
  for (const range of ranges) if (!byPath.has(range.path)) byPath.set(range.path, range);
  return { ranges, byPath };
}

export function rangeForPath(index: XmlIndex, path: string | undefined): XmlRange | undefined {
  if (!path) return undefined;
  return index.byPath.get(normalisePath(path));
}

export function pathAtOffset(index: XmlIndex, offset: number): string | undefined {
  let best: XmlRange | undefined;
  for (const range of index.ranges) {
    if (offset < range.from || offset > range.to) continue;
    if (!best || range.to - range.from <= best.to - best.from) best = range;
  }
  return best?.path;
}

function collectionSize(invoice: Invoice, field: FieldId): number {
  const prefix = field.slice(0, field.indexOf(".{i}"));
  const value = getField(invoice, prefix);
  return Array.isArray(value) ? value.length : 0;
}

function resolveRows(invoice: Invoice, rows: MappingRow[]): MappingRow[] {
  const resolved: MappingRow[] = [];
  for (const row of rows) {
    if (!row.field) continue;
    if (!row.field.includes("{i}")) {
      resolved.push({ ...row, path: normalisePath(row.path) });
      continue;
    }
    const size = collectionSize(invoice, row.field);
    for (let index = 0; index < size; index += 1) {
      resolved.push({
        ...row,
        field: resolveField(row.field, index),
        path: normalisePath(row.path.replaceAll("{i}", String(index))),
      });
    }
  }
  return resolved;
}

function hasBt(row: MappingRow): boolean {
  return Boolean(row.bt);
}

function bestGroup(rows: MappingRow[]): MappingRow[] {
  const groups = new Map<string, MappingRow[]>();
  for (const row of rows) {
    const parent = parentPath(row.path);
    const group = groups.get(parent);
    if (group) group.push(row);
    else groups.set(parent, [row]);
  }
  let best: MappingRow[] | undefined;
  for (const group of groups.values()) {
    if (!best) {
      best = group;
      continue;
    }
    if (group.length > best.length) best = group;
    else if (group.length === best.length && !best.some(hasBt) && group.some(hasBt)) best = group;
  }
  return best ?? rows;
}

function pathForRows(rows: MappingRow[]): string | undefined {
  if (rows.length === 0) return undefined;
  if (rows.length === 1) return rows[0].path;
  const group = bestGroup(rows);
  if (group.length === 1) return group[0].path;
  const paths = group.map((row) => steps(row.path));
  const ancestor = commonPrefix(paths);
  if (ancestor.length === 0) return group[0].path;
  const deepest = Math.max(...paths.map((parts) => parts.length - ancestor.length));
  return deepest <= MAX_STEPS_BELOW_ANCESTOR ? ancestor.join("/") : group[0].path;
}

function collapseBt(rows: MappingRow[]): string | undefined {
  const distinct = [
    ...new Set(rows.map((row) => row.bt).filter((bt): bt is string => Boolean(bt))),
  ];
  if (distinct.length <= 1) return distinct[0];
  const numbers = distinct
    .map((bt) => Number(/^BT-(\d+)/.exec(bt)?.[1]))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return distinct[0];
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  return low === high ? `BT-${low}` : `BT-${low}…${high}`;
}

function collapseFpa(rows: MappingRow[]): string | undefined {
  const distinct = [
    ...new Set(rows.map((row) => row.fpa).filter((fpa): fpa is string => Boolean(fpa))),
  ];
  if (distinct.length <= 1) return distinct[0];
  const shared = commonPrefix(distinct.map((fpa) => fpa.split(".")));
  return shared.length === 0 ? distinct[0] : shared.join(".");
}

export function buildFieldIndex(invoice: Invoice, rows: MappingRow[]): FieldIndex {
  const resolved = resolveRows(invoice, rows);
  const byField = new Map<FieldId, MappingRow[]>();
  const byPath = new Map<string, FieldId>();
  for (const row of resolved) {
    const group = byField.get(row.field);
    if (group) group.push(row);
    else byField.set(row.field, [row]);
    if (!byPath.has(row.path)) byPath.set(row.path, row.field);
  }
  const cache = new Map<FieldId, FieldEntry>();

  const rowsFor = (field: FieldId): MappingRow[] => {
    const exact = byField.get(field);
    if (exact) return exact;
    const prefix = `${field}.`;
    return resolved.filter((row) => row.field.startsWith(prefix));
  };

  return {
    entry(field: FieldId): FieldEntry {
      const cached = cache.get(field);
      if (cached) return cached;
      const matched = rowsFor(field);
      const group = matched.length > 1 ? bestGroup(matched) : matched;
      const entry: FieldEntry = {
        field,
        rows: matched,
        path: pathForRows(matched),
        bt: collapseBt(group),
        fpa: collapseFpa(group),
        label: group[0]?.label,
      };
      cache.set(field, entry);
      return entry;
    },
    fieldForPath(path: string): FieldId | undefined {
      const key = normalisePath(path);
      const exact = byPath.get(key);
      if (exact) return exact;
      const descendant = resolved.find((row) => row.path.startsWith(`${key}/`));
      if (descendant) return descendant.field;
      let ancestor = key;
      while (ancestor.includes("/")) {
        ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
        const hit = byPath.get(ancestor);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}
