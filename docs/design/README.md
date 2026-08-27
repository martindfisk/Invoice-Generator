# Design

Mockups (self-contained HTML) and interaction specs produced by the `ux-designer` agent. Tokens live in `frontend/src/theme.css`; patterns in `.claude/skills/ui-design-system/SKILL.md`.

- [`invoice-viewer.html`](invoice-viewer.html) — static mockup of the invoice viewer: Split / XML-only / Human-only, cross-highlighting, findings panel, DiffView, and the empty / loading / error / polling states. Open it directly in a browser; light, dark and system themes.
- [`viewer-spec.md`](viewer-spec.md) — the interaction contract the viewer implements: selection model, scroll and keyboard behaviour, required `aria-` attributes, severity and badge rules, truncation, breakpoints, and the token used by each element.
