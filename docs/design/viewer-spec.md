# Invoice viewer — interaction contract

Implements `InvoiceViewer/HumanView/XmlView/Field/FindingsPanel/DiffView.tsx`. Visual reference: [`invoice-viewer.html`](invoice-viewer.html); tokens: `frontend/src/theme.css` — nothing below invents a token except the last section.

## Selection model

```ts
type Selection = {
  field?: FieldId;
  path?: string;
  source: "human" | "xml" | "finding";
} | null;
```

One `Selection` in `store.ts`; setting replaces, never merges. `field` is the canonical `FieldId` (`"seller.vatId"`, `"lines.2.netAmount"`); `path` is the absolute node path from `xml-locate.ts` (`"/FatturaElettronica/…/IdFiscaleIVA"`).

| `source`  | Set by                         | `field` from           | `path` from                 | Human view                                 | XML view                        | Findings                                 |
| --------- | ------------------------------ | ---------------------- | --------------------------- | ------------------------------------------ | ------------------------------- | ---------------------------------------- |
| `human`   | click/Enter on `.field`        | the field itself       | mapping row `{field, path}` | `.field--selected`, no scroll              | highlight range, scroll         | highlight findings whose `field` matches |
| `xml`     | click/caret move in CodeMirror | reverse mapping lookup | node under the caret        | `.field--selected`, scroll                 | keep range, no scroll           | same                                     |
| `finding` | click/↑↓ on a `.finding`       | `Finding.field`        | `Finding.xpath`             | selected **and** `.field--flagged`, scroll | severity range + gutter, scroll | `aria-selected`                          |

- A half that cannot be resolved stays `undefined`; that pane clears its highlight and does not throw. A finding highlight always overrides a plain selection on the same row.
- `Esc` sets `null`. Changing view mode or persona keeps the selection; loading a new invoice clears it.
- DiffView `.change` rows publish `{path, field, source: "finding"}` — they behave exactly like a finding.

## Scroll-into-view

- Only the pane that did **not** originate the change scrolls; never both, and never when the target is already fully visible.
- `behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"`, `block: "nearest"`.
- XML: put the range's first line at ~⅓ viewport height; if the range is taller than the viewport, top-align. Human: scroll the `.field`, never past its card's `.card__head`.

## Keyboard

| Key             | Where                           | Behaviour                                                                                                                                                                          |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tab`           | everywhere                      | Visual order: toolbar → segmented control → human fields (card order) → XML pane → findings. The XML pane is one stop (`tabindex="0"`); findings are one stop (roving `tabindex`). |
| `←` `→`         | segmented control               | Move **and** activate (tabs pattern); `Home`/`End` → XML/Split.                                                                                                                    |
| `Enter` `Space` | `.field`, `.finding`, `.change` | Select. `Space` must `preventDefault()` inside the scrolling panes.                                                                                                                |
| `↑` `↓`         | findings list                   | Move the active option _and_ the selection (single-select listbox); no wrap. `Home`/`End` first/last.                                                                              |
| `Esc`           | anywhere                        | Clear the selection; a second `Esc` closes the findings drawer (< 1024 px).                                                                                                        |

Focus ring is the global `:focus-visible` rule — `2px solid var(--fsk-brand)`, `outline-offset: 2px`. Do not remove it inside the panes.

## ARIA

| Element                        | Required attributes                                                                                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.seg` / `.viewer__pane`       | `role="tablist"` + `aria-label="Invoice view mode"`, buttons `role="tab" aria-selected aria-controls` / `role="tabpanel"` + `aria-label`                                                                                                     |
| `.field`                       | native `<button type="button">`, `aria-pressed`, `aria-describedby` → the badge carrying the tooltip text                                                                                                                                    |
| `.badge`                       | `title` = `"<id> <name> — <description> · <path>"` from `bt-catalog.json`; a `<Tooltip>` on hover/focus, `title` is the fallback                                                                                                             |
| `.findings__list` / `.finding` | `role="listbox" aria-label aria-activedescendant` / `role="option" aria-selected id` + roving `tabindex`                                                                                                                                     |
| `.xmlv`                        | `tabindex="0"`, `aria-label`, `aria-readonly="true"` unless "Edit XML" is on                                                                                                                                                                 |
| status / error / loading       | `role="status" aria-live="polite"` (polling updates this node only) / `role="alert"`, no `aria-live` / `aria-busy="true"` on `.viewer__body`, skeletons `aria-hidden`. The disclaimer is plain text — always in the DOM, never `aria-hidden` |

## Severity → token map

| Severity  | Text / marker                | Row background                | Rail + underline         | Glyph | Badge                                                 |
| --------- | ---------------------------- | ----------------------------- | ------------------------ | ----- | ----------------------------------------------------- |
| `fatal`   | `--fsk-severity-fatal`       | `--fsk-severity-fatal-soft`   | `--fsk-severity-fatal`   | ■     | filled: bg `--fsk-severity-fatal`, text `--fsk-white` |
| `error`   | `--fsk-severity-error-ink`   | `--fsk-severity-error-soft`   | `--fsk-severity-error`   | ●     | tint + 1 px `--fsk-severity-error` border             |
| `warning` | `--fsk-severity-warning-ink` | `--fsk-severity-warning-soft` | `--fsk-severity-warning` | ▲     | tint + 1 px `--fsk-severity-warning` border           |
| `info`    | `--fsk-severity-info`        | `--fsk-severity-info-soft`    | `--fsk-severity-info`    | ○     | tint + 1 px `--fsk-severity-info` border              |

Severity must survive greyscale, projector gamma and CVD — the glyph and filled-vs-outline badge carry it as well as hue. Never set message text to `--fsk-severity-error`/`-warning`: on `--fsk-surface` they measure ≈3.3:1 and ≈1.9:1, below AA — use the `-ink` variants or `--fsk-ink`. Diff kinds reuse existing tokens (added → `--fsk-severity-success`, removed → `--fsk-severity-error`, changed → `--fsk-severity-info`), as do the stage dots (pass → success, fail → error, skipped → `--fsk-gray-500` at `opacity: .65`).

## Badge rules

- **BT** (`.badge--bt`, outline `--fsk-brand`) when the mapping row has a `bt`; label `BT-31`, a range collapses to `BT-35…40`. **FPA** (`.badge--fpa`, soft fill) when it has an `fpa`; label is the dotted block number only (`1.2.1.1`) — the element name lives in the tooltip.
- **Both** → BT first, FPA second, always that order. **FPA only** for Italian-only constructs (`RegimeFiscale`, `ProgressivoInvio`, `EsigibilitaIVA`); **BT only** where the format has no dedicated element. Neither → render _no_ badge, never a placeholder.
- UAPI-only fields (delivery channel, `destination_code` routing) get a literal `UAPI` badge in the `.badge--fpa` style.
- In DiffView a change with no BT is labelled `FPA only` — that signals "envelope, not invoice content", the point the presenter makes. Badges are `cursor: help` and never focus stops; the tooltip is reached through the parent `.field`'s `aria-describedby`.

## Truncation & wrapping

| Content                              | Rule                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IBAN, UUIDs, transmission ids        | mono, **middle**-truncate (`.trunc-mid`: head flexes, tail fixed), full value in `title`                                                                          |
| XPaths in findings and changes       | mono, end-truncate (`.trunc`) — the leaf name must survive, so truncate the ancestor path first                                                                   |
| base64 artifact data                 | never render in full: first 48 chars + `…` + a `base64 · N KB` chip + a "Decode & copy" button                                                                    |
| Party names, `Descrizione`, messages | wrap freely, `line-clamp` at 3 lines with the full text in `title`                                                                                                |
| Amounts, quantities                  | `font-variant-numeric: tabular-nums`, right-aligned, never truncated — shrink the column instead                                                                  |
| XML rows                             | `white-space: pre` + horizontal scroll on `.xmlv`. **Never** soft-wrap: it breaks line numbers and gutter markers                                                 |
| Display locale                       | `it-IT` for IT presets (`2.834,72 €`), `nl-BE`/`fr-BE` for BE. The XML always carries the canonical `2834.72` — the human view formats, the serializer never does |

## Responsive

| Width        | Layout                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1280 px    | Split is the default mode: `grid-template-columns: 1fr 1px 1fr`; findings dock under the viewer                                                                     |
| 1024–1279 px | Split still selectable but stacks into rows, Human first; default mode falls back to Human                                                                          |
| < 1024 px    | Findings become a bottom drawer (`.findings--drawer`), `Esc` closes it; `.card__grid--2` collapses to one column. The API log is already a drawer here (shell rule) |

## Element → token reference

| Element                                             | Tokens                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.viewer`, `.viewer__toolbar`, `.viewer__divider`   | `--fsk-surface`, `--fsk-line`, `--fsk-radius-l`, `--fsk-shadow-s`                                                                                                   |
| `.seg` / `.seg__btn[aria-selected="true"]`          | `--fsk-canvas`, `--fsk-line`, `--fsk-radius-m` / `--fsk-surface`, `--fsk-ink`, `--fsk-shadow-s`                                                                     |
| `.human` / `.card` / `.card__head`                  | `--fsk-canvas` / `--fsk-surface`, `--fsk-line`, `--fsk-radius-l` / `--fsk-surface-raised`, `--fsk-ink-muted`                                                        |
| `.field`                                            | label `--fsk-ink-muted`, value `--fsk-ink`, hover `--fsk-surface-raised`, mono `--font-mono`                                                                        |
| `.field--selected` / `.field--flagged`              | `2px solid var(--fsk-brand)` + `--fsk-select-bg` / `inset 3px 0 0 var(--fsk-severity-{sev})`                                                                        |
| `.badge--bt` / `.badge--fpa`                        | `--fsk-brand` outline / `--fsk-surface-raised` (dark `--fsk-canvas`), `--fsk-ink-muted`, `--fsk-radius-m`                                                           |
| `.xmlv`                                             | `--fsk-surface`, `--font-mono`; gutter numbers and the XML declaration `--fsk-gray-500`; tags `--fsk-severity-info`; attributes `--fsk-ink-muted`; text `--fsk-ink` |
| `.xmlv__row--sel`                                   | `--fsk-select-bg` + `inset 2px 0 0 var(--fsk-brand)` + 2 px `--fsk-brand` text underline                                                                            |
| `.xmlv__row--{sev}` / `--{add,del,chg}`             | `--fsk-severity-{sev}-soft` + rail + **wavy** 1 px underline / success·error·info at 12–16 % tint + rail + gutter `+ − ~`                                           |
| `.finding[aria-selected]` / `.toggle:has(:checked)` | `--fsk-select-bg` + `inset 3px 0 0 var(--fsk-brand)` / same + `--fsk-brand` border, `accent-color: var(--fsk-brand)`                                                |
| `.pill--ok` / `.pill--bad`                          | `--fsk-severity-success` / `--fsk-severity-error` + `--fsk-severity-error-soft`                                                                                     |
| `.skel` / `.progress__bar` / `.spinner`             | `--fsk-surface-raised` / `--fsk-brand` / `--fsk-line` + `--fsk-brand`                                                                                               |
| `.errbox` / `.notice` / `.disclaimer`               | `--fsk-severity-error` + `-soft` / `--fsk-severity-warning` + `-soft` / `--fsk-ink-muted` + `1px dashed var(--fsk-line)`                                            |
| MOCK / LIVE chip                                    | `--fsk-brand-soft` + `--fsk-brand-ink` / `--fsk-severity-warning` + `--fsk-bunker` (as in `ModeBadge.tsx`)                                                          |

## Tokens to add

Seven, all derived from the existing palette. Add to both blocks in `theme.css` and expose via `@theme inline` (`--color-select-bg`, `--color-{sev}-soft`, `--color-{sev}-ink`).

| Token                                    | Light                                                                    | Dark                          | Why                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--fsk-select-bg`                        | `color-mix(in srgb, var(--fsk-brand) 14%, transparent)`                  | `… 22% …`                     | Selection tint behind mono text. `--fsk-brand-soft` is too saturated at full opacity and is already the active-stepper fill. |
| `--fsk-severity-{fatal,error,info}-soft` | `color-mix(in srgb, var(--fsk-severity-{sev}) 12%, var(--fsk-surface))`  | `… 22% …`                     | Row, underline and callout backgrounds for findings, diff rows and the error box.                                            |
| `--fsk-severity-warning-soft`            | `… 16% …`                                                                | `… 24% …`                     | Same, but the yellow needs more mix to read against the surface.                                                             |
| `--fsk-severity-error-ink`               | `color-mix(in srgb, var(--fsk-severity-error) 72%, var(--fsk-bunker))`   | `var(--fsk-severity-error)`   | `#ff5050` on white is ≈3.3:1 — fails AA for body text.                                                                       |
| `--fsk-severity-warning-ink`             | `color-mix(in srgb, var(--fsk-severity-warning) 55%, var(--fsk-bunker))` | `var(--fsk-severity-warning)` | The warning amber is ≈1.9:1 on white — unusable as text.                                                                     |

## Decisions on the open questions (2026-08-26)

1. **`--fsk-select-bg`: accepted.** All seven proposed tokens are now in `frontend/src/theme.css` (light, dark and `@theme inline`). Reusing `--fsk-brand-soft` was rejected for the stated reason — it already means "active step" in `WorkflowPane.tsx`, and reusing it would make selection and step-state indistinguishable.
2. **Tab stops: roving tabindex, one stop per card.** ~30 Tab stops in the human view is hostile to keyboard users. Each card (Header, Seller, Buyer, Payment, Lines, VAT breakdown, Totals) is one composite widget: a single stop, arrow keys move between fields inside it, Enter/Space selects. "Tab order follows visual order" still holds — at card granularity. `Field.tsx` therefore takes `tabIndex` from its parent card rather than hardcoding `0`.
3. **Highlight granularity: character ranges, not whole rows.** `xml-locate.ts` builds its index from the CodeMirror Lezer syntax tree, which exposes `from`/`to` offsets for every node, so element _and_ attribute ranges are available. Use `Decoration.mark` for the precise range plus a line decoration for the gutter rail. The mockup's row-level highlight is a simplification of the fidelity to implement.
4. **Natura: N3.5 confirmed** (non imponibili a seguito di dichiarazioni d'intento) for the "Italian B2B (SDI)" preset. `presets.ts` follows the mockup.
5. **Diff content — resolved.** The mockup's diff was a plausible guess at the time; the implemented DiffView compares the locally predicted XML against the real `GET /records/{transmission_id}?compliance-artifact` response (mock fixtures replay a recorded one), with pretty-print and ignore-volatile normalisation toggles.
