---
name: codemirror-jsdom-testing
description: How to test CodeMirror decorations and optional sibling modules in Vitest/jsdom for this frontend
metadata:
  type: project
---

CodeMirror in jsdom renders only the lines it thinks are in view, so DOM assertions on decorations deep in a long document (e.g. `/totals` at the bottom of the composed operation) are unreliable.
**Why:** hit while testing field-fate marks; `tests/compose-json.test.tsx` already notes it and reads long docs from `EditorView.findFromDOM(...).state.doc` instead of the DOM.
**How to apply:** assert decoration rendering on a tiny JsonView/XmlView fixture doc, and assert component wiring through a counting data attribute (e.g. `data-fate-marks` on the JSON tabpanel). Note marks split across syntax-token spans — join `querySelectorAll` text instead of asserting one span.

Related: when a sibling module may not exist yet (another agent owns it), load it with `import.meta.glob("./the-module.ts", { eager: true })` in an adapter — build and typecheck pass either way. But `vi.mock` cannot inject a module the glob never matched, so tests must mock the adapter (`vi.mock("../src/field-fate", importOriginal ...)`) and the adapter's consumers must import the adapter's function directly (internal same-module calls bypass the mock).
