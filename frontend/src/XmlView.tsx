import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { XmlRange } from "./xml-locate";

type Range = Pick<XmlRange, "from" | "to">;

const setSelectedRange = StateEffect.define<Range | null>();

function decorate(state: EditorState, range: Range): DecorationSet {
  const decorations = [];
  const to = Math.min(range.to, state.doc.length);
  const from = Math.min(range.from, to);
  for (let position = from; position <= to;) {
    const line = state.doc.lineAt(position);
    decorations.push(Decoration.line({ class: "cm-selected-line" }).range(line.from));
    if (line.to >= to) break;
    position = line.to + 1;
  }
  if (to > from) {
    decorations.push(Decoration.mark({ class: "cm-selected-range" }).range(from, to));
  }
  return Decoration.set(decorations, true);
}

const selectedRange = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSelectedRange)) continue;
      next = effect.value === null ? Decoration.none : decorate(transaction.state, effect.value);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const THEME = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--fsk-surface)",
    color: "var(--fsk-ink)",
    fontSize: "12px",
  },
  "&.cm-focused": { outline: "2px solid var(--fsk-brand)", outlineOffset: "-2px" },
  ".cm-content": { fontFamily: "var(--font-mono)", paddingBlock: "8px" },
  ".cm-line": { paddingInline: "12px" },
  ".cm-gutters": {
    backgroundColor: "var(--fsk-surface)",
    color: "var(--fsk-gray-500)",
    border: "0",
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
  },
  ".cm-selected-line": { boxShadow: "inset 2px 0 0 var(--fsk-brand)" },
  ".cm-selected-range": {
    backgroundColor: "var(--fsk-select-bg)",
    textDecoration: "underline",
    textDecorationColor: "var(--fsk-brand)",
    textDecorationThickness: "2px",
    textUnderlineOffset: "3px",
  },
});

export type XmlViewProps = {
  text: string;
  label: string;
  range?: Range;
  scrollTo: boolean;
  editable: boolean;
  onPickOffset: (offset: number) => void;
  onChange: (text: string) => void;
};

export function XmlView({
  text,
  label,
  range,
  scrollTo,
  editable,
  onPickOffset,
  onChange,
}: XmlViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const config = useRef(new Compartment());
  const doc = useRef(text);
  const applying = useRef(false);
  const pick = useRef(onPickOffset);
  const change = useRef(onChange);

  useEffect(() => {
    pick.current = onPickOffset;
    change.current = onChange;
  }, [onPickOffset, onChange]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: doc.current,
        extensions: [
          lineNumbers(),
          xml(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          config.current.of([]),
          selectedRange,
          THEME,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applying.current) return;
            doc.current = update.state.doc.toString();
            change.current(doc.current);
          }),
          EditorView.domEventHandlers({
            mousedown(event, current) {
              const offset = current.posAtCoords({ x: event.clientX, y: event.clientY });
              if (offset !== null) pick.current(offset);
              return false;
            },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: config.current.reconfigure([
        EditorView.contentAttributes.of({
          tabindex: "0",
          "aria-label": label,
          "aria-readonly": editable ? "false" : "true",
        }),
        ...(editable ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]),
      ]),
    });
  }, [label, editable]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || text === doc.current) return;
    doc.current = text;
    applying.current = true;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    applying.current = false;
  }, [text]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ effects: setSelectedRange.of(range ?? null) });
    if (!range || !scrollTo) return;
    editor.dispatch({
      effects: EditorView.scrollIntoView(Math.min(range.from, editor.state.doc.length), {
        y: "start",
        yMargin: Math.round(editor.dom.clientHeight / 3),
      }),
    });
  }, [text, range, scrollTo]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden bg-surface" />;
}
