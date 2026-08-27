import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { useEffect, useRef } from "react";

type Range = { from: number; to: number };

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
    maxHeight: "inherit",
    height: "100%",
    backgroundColor: "var(--fsk-canvas)",
    color: "var(--fsk-ink)",
    fontSize: "11px",
  },
  "&.cm-focused": { outline: "2px solid var(--fsk-brand)", outlineOffset: "-2px" },
  ".cm-scroller": { overflow: "auto", lineHeight: "1.5" },
  ".cm-content": { fontFamily: "var(--font-mono)", paddingBlock: "6px" },
  ".cm-line": { paddingInline: "8px" },
  ".cm-gutters": {
    backgroundColor: "var(--fsk-canvas)",
    color: "var(--fsk-gray-500)",
    border: "0",
    fontFamily: "var(--font-mono)",
    fontSize: "10px",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--fsk-select-bg)",
    border: "1px solid var(--fsk-line)",
    color: "var(--fsk-ink-muted)",
    padding: "0 4px",
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

export type JsonViewProps = {
  text: string;
  label: string;
  maxHeight?: number;
  range?: Range;
  scrollTo?: boolean;
  editable?: boolean;
  onPickOffset?: (offset: number) => void;
  onChange?: (text: string) => void;
};

export function JsonView({
  text,
  label,
  maxHeight,
  range,
  scrollTo = false,
  editable = false,
  onPickOffset,
  onChange,
}: JsonViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const config = useRef(new Compartment());
  const doc = useRef(text);
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
          foldGutter(),
          json(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
          config.current.of([]),
          selectedRange,
          THEME,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            if (next === doc.current) return;
            doc.current = next;
            change.current?.(next);
          }),
          EditorView.domEventHandlers({
            mousedown(event, current) {
              const offset = current.posAtCoords({ x: event.clientX, y: event.clientY });
              if (offset !== null) pick.current?.(offset);
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
        ...(editable
          ? []
          : [
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              EditorView.lineWrapping,
            ]),
      ]),
    });
  }, [label, editable]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || text === doc.current) return;
    doc.current = text;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
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

  return (
    <div
      ref={host}
      role="group"
      aria-label={label}
      className="min-h-0 flex-1 overflow-hidden rounded-m border border-line bg-canvas"
      style={maxHeight === undefined ? undefined : { maxHeight }}
    />
  );
}
