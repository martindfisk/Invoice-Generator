---
name: react-vite-conventions
description: Frontend conventions for this repo — Vite + React 19 + TypeScript strict, flat src/, useSyncExternalStore store, uapi-client + SSE, CodeMirror 6 patterns, Tailwind v4 with fiskaly tokens, testing and scripts. Load before editing anything under frontend/.
---

# Frontend conventions (`frontend/`)

- **Layout**: flat `src/` — one file per concern (see `docs/ARCHITECTURE.md` table). Add a folder only when a concern exceeds ~5 files. Tests in `tests/` (Vitest, jsdom), e2e in `e2e/` (Playwright, MOCK mode), build scripts in `scripts/*.mjs`, generated types in `src/gen/` (git-ignored, `npm run gen-types`).
- **State**: `store.ts` exposes `getState()`, `subscribe()`, typed actions, and hooks built on `useSyncExternalStore`. One `selection: {field?: FieldId; path?: string} | null` drives all highlights. Workflow state is a reducer in `workflow.ts`; persisted slices → `localStorage` (never API-log data or anything secret).
- **Backend access**: only `uapi-client.ts` (`fetch` to `/api/...`, JSON) and `api-log.ts` (`EventSource("/api/events")`, event `call`, reconnect with backoff, `Last-Event-ID`). Vite dev server proxies `/api` → `http://localhost:8000`.
- **Money**: decimal strings through `decimal.ts` (`add`, `mul`, `round2`, `cmp`); never `Number` arithmetic on amounts.
- **Types**: UAPI shapes from `src/gen/uapi.d.ts` only; domain types from `model.ts`.
- **CodeMirror 6**: `EditorState.create({doc, extensions: [xml(), lineNumbers(), highlightDecorations, readOnlyCompartment]})`; highlights are `Decoration.mark`/`Decoration.line` in a `StateField` updated via a `StateEffect` from the store selection; locate elements through `syntaxTree(state)` (`xml-locate.ts`). Diff via `@codemirror/merge` `MergeView`.
- **Styling**: Tailwind v4 utilities + `theme.css` tokens (`--fsk-*` mapped in `@theme`). No inline hex colours. Components from the shadcn subset (tabs, tooltip, resizable panels) copied into `src/`; no new UI libraries.
- **Accessibility**: focus-visible rings, keyboard-operable stepper and toggles, `aria-live="polite"` for polling/status text, `aria-selected` on the active view.
- **Errors**: backend offline → non-blocking pill; UAPI errors shown with `code` + `message`; never swallow.
- **Scripts**: `npm run dev|build|preview|lint|format|typecheck|test|test:e2e|gen-types`. All of `lint`, `typecheck`, `test`, `build` must pass before handing over.
- **No comments/JSDoc**; names carry meaning. No default exports except React lazy boundaries.
