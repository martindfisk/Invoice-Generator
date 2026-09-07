# 05 — The Mapper

The Mapper is the app's centre of gravity: three synchronized views of one invoice, all editable,
all cross-highlighted. Its premise inverts the usual mental model — **the JSON operation is _the_
artifact** (it is what Send posts, unchanged), the form fields are a friendly handle on it, and the
XML is a _prediction_ of what fiskaly will generate.

## The three panes

| Pane                          | Shows                                                                                                                                              | Editable                                           | Can hide                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------- |
| **Fields** (`HumanView`)      | The model as EN 16931 business groups (BG-0 Document, BG-4 Seller, BG-25 Lines, …), each field with its BT badge and the format-specific reference | yes — click a value, Enter applies, Escape cancels | yes                     |
| **fiskaly JSON** (`JsonView`) | The `TRANSACTION::INVOICE` (or `::CORRECTION`) operation, with fate marks and the spec-coverage line                                               | yes — free-text JSON editing                       | no — it is the artifact |
| **Predicted XML** (`XmlView`) | The chosen format's rendering, generated in the browser                                                                                            | yes — free-text XML editing                        | yes                     |

A format switch (UBL · XRECHNUNG · CII · FATTURAPA) re-renders the XML pane from the same model;
only formats whose writer accepts the invoice are offered (`unsupportedReason`,
[03](03-mappings.md#the-format-plugin-seam)). Pane visibility and layout ratios persist per user.

## Editing

All three panes write to the same model through the store:

- **Field edit** → `setField` on the dot-path, immediate dispatch.
- **XML edit** → debounced 400 ms, then `parse(text)` through the format plugin. A parse failure
  keeps the last good invoice and shows the parser's message; a successful parse replaces the model
  and re-derives the other panes.
- **JSON edit** → debounced 400 ms, then `applyOperation` reads it back into the model.

Each editor has its own debounce timer, and a field edit **flushes** pending XML/JSON edits first
so cross-pane edits land in order instead of silently cancelling each other
(`InvoiceWorkbench.tsx`).

**Lossiness is measured, not assumed.** After a hand edit is parsed, the app re-serialises and
compares: if regeneration would not reproduce your text, the edit held content the mapping (or the
model) cannot carry, and a persistent notice says so the moment a later edit forces regeneration
([09](09-limitations.md#lossy-edits)). The XML and JSON panes have symmetrical notices
(`LOSS_NOTICE` / `JSON_LOSS_NOTICE` in `workflow.ts`).

## Selection & cross-highlighting

One selection object rules all panes:

```ts
type Selection = {
  field?: FieldId;
  path?: string;
  pointer?: string;
  source: "human" | "xml" | "json" | "finding";
} | null;
```

- Click a **field** → the mapping table gives its XML path, `UAPI_POINTER_FIELDS` (plus the
  structural mapping) gives its JSON pointer; both panes scroll to and highlight the ranges.
- Click into the **XML** → `xml-locate.ts` builds a path index from the CodeMirror Lezer parse
  tree, resolves the offset to a document path, and the mapping table resolves that back to a
  `FieldId`.
- Click into the **JSON** → `uapi-json.tsx` maintains a JSON-Pointer index over the text (its own
  tolerant tokenizer, so it works mid-edit) and resolves pointers to fields the same way.
- Click a **finding** in Validate → the finding's xpath/pointer resolves through the same indexes,
  so every pane shows its own rendering of the problem.

The `source` field prevents feedback loops (the pane that originated a selection doesn't scroll
itself) and lets `HumanView` auto-reveal the group a foreign selection lands in — while still
letting you collapse it again.

Directly under the pane toggles, the **PresenceStrip** answers, for the selected field: does the
model carry it, does the operation carry it, does the chosen syntax carry it — quoting the declared
reason when one of them doesn't.

## The spec-coverage line

Under the JSON sits `CoveragePanel`: the backend walks the OpenAPI spec's `InvoiceTransaction`
closure into a flat field catalogue (`GET /api/spec/fields`,
[07](07-send-and-backend.md#the-contract)), and the panel measures the composed operation against
it — _n of m spec fields populated_. Expanding it lists every unpopulated field with its
constraints, BT ids and the spec's own example value, each with an **Insert** button that writes
the example into the JSON exactly as typing would. Inserts are honest:

- a field whose insertion alone would not validate is blocked with the reason,
- a field with a fate annotation gets "Insert anyway — discarded/not rendered/platform",
- a field no form control addresses is marked "stays only in the JSON" (a later field edit
  re-derives the JSON without it),
- a refused insert (bad pointer, array that doesn't exist) reports _why_ instead of doing nothing.

## Fate marks

Fields with gateway evidence ([03](03-mappings.md#field-fates-evidence-not-hope)) are underlined in
the JSON pane — amber **discarded**, muted **not rendered**, blue **platform** — with the evidence
note as tooltip and a legend row ("Field fates: … · Hide fate marks"). FatturaPA only, because
that is where the evidence exists.

## App state, in one paragraph

`store.ts` is a hand-rolled store on `useSyncExternalStore` — no Redux/Zustand. UI events dispatch
`WorkflowAction`s into a pure reducer (`workflow.ts`); the workflow state holds the step, the
invoice, the edit state (hand-edited texts + lossiness), the selection, pane/group view state, the
validation run, the send state machine ([07](07-send-and-backend.md)) and the correction target.
Everything a reload should survive — invoice, edits, send record ids, correction target, layout —
persists to `localStorage` (debounced, flushed on pagehide, **never** tokens); an interrupted send
restores as a resumable "stopped". The store also carries the API-call log fed by the SSE stream
and the backend config/settings snapshots.

Step gating is minimal by design: only Setup is reachable before a preset is chosen (`stepLock`);
after that all four steps are free — the stepper is navigation, not a wizard.

Next: what judges the invoice — [06 — Validation](06-validation.md).
