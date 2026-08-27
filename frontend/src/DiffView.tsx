import { xml as xmlLanguage } from "@codemirror/lang-xml";
import { MergeView, presentableDiff } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./store";

const INDENT = "  ";

const VOLATILE: { label: string; pattern: RegExp; replacement: string }[] = [
  {
    label: "uuid",
    pattern: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    replacement: "«uuid»",
  },
  {
    label: "timestamp",
    pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    replacement: "«timestamp»",
  },
  {
    label: "progressivo",
    pattern: /(<(?:\w+:)?ProgressivoInvio>)[^<]*(<\/)/g,
    replacement: "$1«progressivo»$2",
  },
  {
    label: "signature",
    pattern: /(<(?:\w+:)?(?:SignatureValue|DigestValue|X509Certificate)>)[^<]*(<\/)/g,
    replacement: "$1«signature»$2",
  },
];

const THEME_SPEC = {
  "&": { backgroundColor: "var(--fsk-surface)", color: "var(--fsk-ink)", fontSize: "11px" },
  "&.cm-focused": { outline: "2px solid var(--fsk-brand)", outlineOffset: "-2px" },
  ".cm-scroller": { overflow: "auto", lineHeight: "1.5" },
  ".cm-content": { fontFamily: "var(--font-mono)", paddingBlock: "6px" },
  ".cm-line": { paddingInline: "8px" },
  ".cm-gutters": {
    backgroundColor: "var(--fsk-surface)",
    color: "var(--fsk-gray-500)",
    border: "0",
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
  },
};

const THEMES = {
  light: EditorView.theme(THEME_SPEC),
  dark: EditorView.theme(THEME_SPEC, { dark: true }),
};

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function openTag(element: Element): string {
  const attributes = [...element.attributes]
    .map(
      (attribute) => ` ${attribute.name}="${escapeText(attribute.value).replace(/"/g, "&quot;")}"`,
    )
    .join("");
  return `<${element.nodeName}${attributes}`;
}

function writeElement(element: Element, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  const children = [...element.childNodes].filter(
    (node) => node.nodeType !== 3 || (node.textContent ?? "").trim() !== "",
  );
  if (children.length === 0) {
    out.push(`${pad}${openTag(element)}/>`);
    return;
  }
  if (children.every((node) => node.nodeType === 3)) {
    const text = children.map((node) => (node.textContent ?? "").trim()).join("");
    out.push(`${pad}${openTag(element)}>${escapeText(text)}</${element.nodeName}>`);
    return;
  }
  out.push(`${pad}${openTag(element)}>`);
  for (const child of children) {
    if (child.nodeType === 1) writeElement(child as Element, depth + 1, out);
    else if (child.nodeType === 8) {
      out.push(`${INDENT.repeat(depth + 1)}<!--${child.textContent ?? ""}-->`);
    } else out.push(`${INDENT.repeat(depth + 1)}${escapeText((child.textContent ?? "").trim())}`);
  }
  out.push(`${pad}</${element.nodeName}>`);
}

function prettyXml(xml: string): string {
  const document_ = new DOMParser().parseFromString(xml, "application/xml");
  const root = document_.documentElement;
  if (!root || document_.getElementsByTagName("parsererror").length > 0) return xml;
  const out: string[] = [];
  const declaration = xml.match(/^<\?xml[^?]*\?>/);
  if (declaration) out.push(declaration[0]);
  for (const node of [...document_.childNodes]) {
    if (node.nodeType === 7) {
      const instruction = node as ProcessingInstruction;
      out.push(`<?${instruction.target} ${instruction.data}?>`);
    }
  }
  writeElement(root, 0, out);
  return out.join("\n");
}

function maskVolatile(xml: string): string {
  return VOLATILE.reduce(
    (text, rule) => text.replace(rule.pattern, rule.replacement),
    xml.replace(/\r\n/g, "\n"),
  );
}

function normalise(xml: string, pretty: boolean, ignoreVolatile: boolean): string {
  const printed = pretty ? prettyXml(xml) : xml.replace(/\r\n/g, "\n");
  return ignoreVolatile ? maskVolatile(printed) : printed;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

function lineTextAt(text: string, offset: number): string {
  const at = Math.max(0, Math.min(offset, text.length));
  const start = text.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const end = text.indexOf("\n", at);
  const value = text
    .slice(start, end === -1 ? text.length : end)
    .trim()
    .replace(/\s+/g, " ");
  if (value === "") return "—";
  return value.length > 90 ? `${value.slice(0, 90)}…` : value;
}

type ChangeRow = {
  key: string;
  line: number;
  fromA: number;
  fromB: number;
  local: string;
  remote: string;
};

const MAX_ROWS = 25;

function changeRows(a: string, b: string): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const change of presentableDiff(a, b)) {
    const row = {
      key: `${change.fromA}-${change.fromB}`,
      line: lineAt(b, change.fromB),
      fromA: change.fromA,
      fromB: change.fromB,
      local: lineTextAt(a, change.fromA),
      remote: lineTextAt(b, change.fromB),
    };
    const previous = rows[rows.length - 1];
    if (previous && previous.local === row.local && previous.remote === row.remote) continue;
    rows.push(row);
  }
  return rows;
}

function paneState(doc: string, theme: "light" | "dark"): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      xmlLanguage(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      THEMES[theme],
    ],
  });
}

export type DiffViewProps = {
  localXml: string;
  localLabel: string;
  remoteXml: string;
  remoteLabel: string;
  caveat?: string | null;
};

export function DiffView({ localXml, localLabel, remoteXml, remoteLabel, caveat }: DiffViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView | null>(null);
  const theme = useStore((state) => state.theme);
  const [pretty, setPretty] = useState(true);
  const [ignoreVolatile, setIgnoreVolatile] = useState(true);

  const left = useMemo(
    () => normalise(localXml, pretty, ignoreVolatile),
    [localXml, pretty, ignoreVolatile],
  );
  const right = useMemo(
    () => normalise(remoteXml, pretty, ignoreVolatile),
    [remoteXml, pretty, ignoreVolatile],
  );
  const rows = useMemo(() => changeRows(left, right), [left, right]);
  const identical = left === right;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const view = new MergeView({
      parent,
      a: paneState(left, theme),
      b: paneState(right, theme),
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    merge.current = view;
    return () => {
      view.destroy();
      merge.current = null;
    };
  }, [left, right, theme]);

  const reveal = (row: ChangeRow) => {
    const view = merge.current;
    if (!view) return;
    view.a.dispatch({ effects: EditorView.scrollIntoView(row.fromA, { y: "center" }) });
    view.b.dispatch({ effects: EditorView.scrollIntoView(row.fromB, { y: "center" }) });
  };

  return (
    <section
      aria-label="Compliance artifact diff"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-l border border-line bg-surface shadow-s"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <h3 className="text-xs font-semibold text-ink">
          Predicted XML <span className="text-muted">vs</span> the document fiskaly transmitted
        </h3>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={pretty}
            onChange={(event) => setPretty(event.target.checked)}
            className="accent-brand"
          />
          Pretty-print
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={ignoreVolatile}
            onChange={(event) => setIgnoreVolatile(event.target.checked)}
            className="accent-brand"
          />
          Ignore volatile ids &amp; timestamps
        </label>
        <span
          role="status"
          data-diff-summary={identical ? "identical" : String(rows.length)}
          className={`ml-auto rounded-m px-2 py-0.5 text-[11px] ${
            identical ? "bg-brand-soft text-brand-ink" : "bg-warning-soft text-warning-ink"
          }`}
        >
          {identical
            ? "Identical after normalisation"
            : `${rows.length} changed ${rows.length === 1 ? "line" : "lines"}`}
        </span>
      </header>
      {caveat && (
        <p
          role="alert"
          data-diff-caveat="mock"
          className="flex shrink-0 items-start gap-2 border-b border-line bg-warning-soft px-3 py-2 text-[11px] text-warning-ink"
        >
          <span aria-hidden="true">▲</span>
          <span className="min-w-0 flex-1">{caveat}</span>
        </p>
      )}
      <div className="grid shrink-0 grid-cols-2 gap-px border-b border-line bg-line text-[11px]">
        <span className="bg-surface px-3 py-1 font-medium text-muted">{localLabel}</span>
        <span className="bg-surface px-3 py-1 font-medium text-muted">{remoteLabel}</span>
      </div>
      <div ref={host} className="min-h-0 flex-1 overflow-auto" />
      {rows.length > 0 && (
        <ul
          aria-label="Changed regions"
          className="max-h-40 shrink-0 overflow-auto border-t border-line text-[11px]"
        >
          {rows.slice(0, MAX_ROWS).map((row) => (
            <li key={row.key} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => reveal(row)}
                className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-select-bg"
              >
                <span className="font-mono text-[10px] text-muted">line {row.line}</span>
                <span className="font-mono break-all text-muted">
                  <span className="text-ink">predicted</span> {row.local}
                </span>
                <span className="font-mono break-all text-muted">
                  <span className="text-ink">fiskaly</span> {row.remote}
                </span>
              </button>
            </li>
          ))}
          {rows.length > MAX_ROWS && (
            <li className="px-3 py-1.5 text-muted">
              and {rows.length - MAX_ROWS} more — the two documents differ structurally, not just in
              detail.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
