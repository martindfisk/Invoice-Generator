---
paths:
  - "frontend/**"
---

# Frontend rules

- React + TypeScript + Vite. Flat `frontend/src/` — one file per concern; add a folder only when a concern has more than ~5 files.
- State lives in `store.ts` (`useSyncExternalStore`); no zustand/redux/react-query/axios. Fetch via `uapi-client.ts` only.
- Amounts are decimal strings handled by `decimal.ts`. Never `parseFloat` money.
- Styling: Tailwind utilities + the `--fsk-*` tokens from `theme.css`. No inline hex colours; no new UI libraries — the stack is React 19, CodeMirror 6, `react-resizable-panels`, and hand-rolled components (`Modal.tsx`, `Split.tsx`, …).
- XML text is shown through CodeMirror (`XmlView.tsx`); every highlight goes through the single `selection` in the store so XML and Human views stay in sync.
- Generated types in `src/gen/` are build output (`make spec` → `gen-types`); never hand-edit, never import UAPI shapes from anywhere else.
- Tests: Vitest next to the code under `tests/`; Playwright in `e2e/` runs against MOCK mode only.
- Do not add comments, docstrings or JSDoc to code you did not change.
