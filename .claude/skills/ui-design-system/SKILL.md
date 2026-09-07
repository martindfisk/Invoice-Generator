---
name: ui-design-system
description: Visual and interaction rules for the Invoice Generator UI — fiskaly tokens, layout grammar of the split screen, invoice viewer toggle and cross-highlighting, findings severity, API call card anatomy, badges, empty/loading/error states, disclaimer, accessibility. Load for any UI or mockup work.
---

# UI design system

## Tokens (source of truth: `frontend/src/theme.css`)
fiskaly palette from the `--fsk-*` set: Bunker `#0F181B` (dark surface/text), Turquoise `#2DD4BF` (`--fsk-green-500`, brand accent), brand-700 `#14B8A6` (accent on light), Comet `#545B6F` (`--fsk-gray-700`, secondary text), red `#FF5050` (errors), radii 4/8/16, two shadows. Fonts: DM Sans (UI), DM Mono (XML, JSON, identifiers, amounts). Themes: light default, dark via `[data-theme="dark"]`, both WCAG AA on text.
Severity: fatal/error → red, warning → amber, info → blue, success/completed → turquoise/green. HTTP status: 2xx green, 3xx grey, 4xx amber, 5xx red; LIVE badge turquoise outline, MOCK badge amber filled; persona badge Seller (solid) / Buyer (outline).

## Layout grammar
Top bar 56 px: product name · preset/format chip · PersonaSwitch · ModeBadge · environment (TEST/LIVE) · theme toggle. Below: horizontal resizable panels, left workflow (min 480 px) / right API log (min 360 px); default 60/40. Below 1024 px the API log becomes a bottom drawer.
Workflow pane: stepper `setup → mapper → validate → send` (done/active/blocked states), content card per step, sticky action row (primary button + secondary), status line with `aria-live`.

## Invoice viewer
Segmented control XML | Human | Split (Split default ≥ 1280 px). Human view = cards per business group (Header, Seller, Buyer incl. channel/identifiers, Delivery, Payment, Lines table, VAT breakdown table, Totals); each `Field` shows label, value (mono for identifiers/amounts), BT badge (`BT-31`) or FPA badge (`1.2.1.1`) with tooltip (name, description, path). Selecting a field outlines it (2 px brand) and underlines the XML range + gutter marker; selecting XML does the reverse; findings use severity colours. DiffView: two panes (local | fiskaly artifact) with normalisation toggles and a semantic change list. Always render the disclaimer under the human view: "Visualisation for review — the XML is the legally valid invoice."

## API log
Cards newest first: row 1 method (mono, coloured), path (truncate middle), status pill, latency; row 2 step chip, persona chip, LIVE/MOCK, timestamp, record id link; expand → tabs Request / Response (JSON, read-only CodeMirror) / cURL (copy button, `Bearer $FISKALY_TOKEN`). Filter chips by step and persona; "clear" keeps server history.

## States
Empty (no preset yet, no calls yet), loading/polling (skeleton + "polling GET /records/{id} … n/timeout"), error (code + message + trace id, retry), MOCK notice, DEGRADED system guidance, backend offline pill. Keyboard: Tab order follows visual order **at card granularity** — each human-view card is one composite widget (single Tab stop, arrow keys between fields inside, Enter/Space selects); `Esc` closes drawers; focus ring `--fsk-green-500`.
Highlighting: XML highlights use character ranges from `xml-locate.ts` (`Decoration.mark` on the element/attribute range) plus a line decoration for the gutter rail — never whole-row only.
Severity text colour: never render message text in `--fsk-severity-error`/`-warning` (≈3.3:1 and ≈1.9:1 on surface, below AA). Use `--fsk-severity-error-ink` / `--fsk-severity-warning-ink` for text and the `-soft` variants for backgrounds. Field selection uses `--fsk-select-bg`, never `--fsk-brand-soft` (that means "active step").
