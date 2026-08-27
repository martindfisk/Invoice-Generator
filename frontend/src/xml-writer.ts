export type XmlAttrs = Record<string, string | undefined>;

export type XmlNode = {
  name: string;
  attrs?: XmlAttrs;
  children?: XmlNode[];
  text?: string;
};

type PathHolder = { path: string };

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ENTITIES[character]);
}

export function elementName(path: string): string {
  const step = path.split("/").filter(Boolean).pop() ?? "";
  return step.replace(/\[[^\]]*\]/g, "");
}

export function attributeName(path: string): string {
  const step = elementName(path);
  if (!step.startsWith("@")) {
    throw new Error(`xml-writer: "${path}" is not an attribute path`);
  }
  return step.slice(1);
}

function isEmpty(value: string | undefined | null): value is undefined | null {
  return value === undefined || value === null || value === "";
}

export function el(
  row: PathHolder,
  value: string | undefined | null,
  attrs?: XmlAttrs,
): XmlNode | null {
  if (isEmpty(value)) return null;
  return { name: elementName(row.path), attrs, text: value };
}

export function attr(row: PathHolder, value: string | undefined | null): XmlAttrs {
  if (isEmpty(value)) return {};
  return { [attributeName(row.path)]: value };
}

export function node(name: string, children: (XmlNode | null)[], attrs?: XmlAttrs): XmlNode {
  return { name, attrs, children: children.filter((child): child is XmlNode => child !== null) };
}

export function group(
  name: string,
  children: (XmlNode | null)[],
  attrs?: XmlAttrs,
): XmlNode | null {
  const kept = children.filter((child): child is XmlNode => child !== null);
  return kept.length === 0 ? null : { name, attrs, children: kept };
}

function serializeAttrs(attrs: XmlAttrs | undefined): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");
}

function serializeNode(current: XmlNode, depth: number, indent: string, lines: string[]): void {
  const pad = indent.repeat(depth);
  const open = `${current.name}${serializeAttrs(current.attrs)}`;
  const children = current.children ?? [];
  if (children.length === 0 && isEmpty(current.text)) {
    lines.push(`${pad}<${open}/>`);
    return;
  }
  if (children.length === 0) {
    lines.push(`${pad}<${open}>${escapeXml(current.text ?? "")}</${current.name}>`);
    return;
  }
  lines.push(`${pad}<${open}>`);
  for (const child of children) serializeNode(child, depth + 1, indent, lines);
  lines.push(`${pad}</${current.name}>`);
}

export function serialize(
  root: XmlNode,
  options: { declaration?: boolean; indent?: string } = {},
): string {
  const lines: string[] = [];
  if (options.declaration !== false) lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  serializeNode(root, 0, options.indent ?? "  ", lines);
  return `${lines.join("\n")}\n`;
}
