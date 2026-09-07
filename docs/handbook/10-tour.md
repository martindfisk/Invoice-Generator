# 10 — Screen-by-screen tour

Every screen, control and badge, in the order a user meets them. The presentation choreography
(what to say, in which act) lives in [docs/DEMO-SCRIPT.md](../DEMO-SCRIPT.md); this is the _what
everything is_.

## The header bar

Always visible: the app title and subtitle · the **section switch** (_Invoice flow_ | _Test
runner_) · on the right, the **environment badge** (`TEST`/`LIVE` — which fiskaly host the backend
points at; LIVE additionally paints a warning banner under the header) · the **mode badge**
(`MOCK`/`LIVE` — fixtures vs real calls; click-through to switching) · a theme toggle · **Settings**.
In the Test runner section only, a **persona switch** (Seller/Buyer) appears — the invoice flow
always sends as the seller. A red "backend offline" pill shows when `/api/config` is unreachable.

## Step 1 — Setup

A preset matrix: rows Germany/Italy/Belgium, columns B2C/B2B/B2G, eleven scenario cards. Each card
carries chips for the channel (SDI/PEPPOL/EMAIL), its scenario group, and — where applicable — an
amber **"broken on purpose"** chip; the tooltip holds the scenario's story. Clicking a card loads
its invoice and jumps to the Mapper. Re-clicking the already-chosen card _keeps your work_ and just
returns to the Mapper; an explicit **Reset preset** control (shown once something is chosen) is the
deliberate start-over. On narrow viewports the matrix becomes a country-grouped list. Later steps
stay disabled until a preset is chosen — the only gate in the stepper.

## Step 2 — Mapper

Header: preset name, format + spec version (e.g. `FatturaPA 1.2.3 (FPR12)`), legal basis
(`D.Lgs. 127/2015 art. 1; specs 1.9.1`). Below it:

- **Pane toggles** — _fiskaly JSON_ (fixed on), _Fields_, _Predicted XML_ — and the **format
  switch** (UBL · XRECHNUNG · CII · FATTURAPA); formats the invoice cannot render are absent, with
  the reason available. A "Model rules pass/fail" chip summarises the sync tier.
- **PresenceStrip** — for the selected field: does the model / the operation / the chosen syntax
  carry it, with the declared reason when one does not.
- **Fields pane** — the invoice as EN 16931 business groups, each group headed `BG-x · name ·
cardinality` with a set-count tally and a findings glyph; every field shows its BT badge (or
  "not carried by FatturaPA") and the format path on hover. Click to edit; Enter applies, Escape
  cancels. A checkbox reveals fields the current format cannot carry.
- **JSON pane** — the `TRANSACTION::INVOICE` operation with **fate marks** (dotted underlines:
  amber discarded, muted not-rendered, blue platform; legend + hide toggle), the
  **spec-coverage line** ("n of m spec fields populated" — expandable to per-field Insert buttons),
  and the operation caveats (correction-pending note, loss notes) past the end of the payload.
- **XML pane** — the predicted document, editable, with the header note that nothing here is
  transmitted; fiskaly's actual document is fetched in Send.

Click anything anywhere and all panes highlight their rendering of it. Buttons: **Continue to
Validate**, **Change preset**.

## Step 3 — Validate

Top half: the same three-pane workbench (editing continues to revalidate live). Bottom half:

- **Pipeline** — two labelled tiers. _fiskaly API contract_ first (the only stage about what Send
  posts), then _The predicted XML_ stages: model rules, well-formedness, XSD, Schematron, SDI
  rules. Each row: status glyph (Pending/Running/Passed/Failed/**Not run**), duration, and an
  explanatory note naming the engine and — for Schematron — the rule-set versions that fired.
- **Findings panel** — every finding with severity glyph (■ fatal ● error ▲ warning ○ info),
  rule id, message; filter chips by severity and stage; keyboard navigable. Clicking a finding
  selects it everywhere (field, XML range, JSON pointer).
- **Action row** — _Re-run_, _Back to Mapper_, a live status line ("The payload matches the fiskaly
  API contract. Every stage passed." / "…not a clean bill of health"), and **Continue to Send** —
  which turns amber **"Send anyway"** when blocking findings exist. Warned, never blocked.

## Step 4 — Send

- **Mode banner** — MOCK: "no request leaves this machine…"; LIVE: which host, and what that means.
- **Preflight** (collapsible, open until the first send) — persona/system/credentials checks, the
  channel summary, warnings (missing system id → the passthrough fallback note), and the exact
  **operation payload** that will be posted, labelled "posted unchanged".
- **Transmission lifecycle timeline** — four nodes (_Intention_, _Transaction_, _Transmission_,
  _Artifacts_), each with its call shape, live state/mode chips, duration, and the **record id as a
  button** — clicking it scrolls the API log to the calls for that record. Failure states carry the
  record's log lines verbatim (e.g. SDI `00471`); a completed transaction without a transmission
  says "nothing was handed to the network".
- **Outcome banner** — Transmitted / Rejected / Failed / Nothing was transmitted / Still processing
  (timeout) / Polling paused (stopped) / The call failed — each with honest copy.
- **Artifacts row** — _Show Receipt of Transmission_ (Italy's ricevuta, when present), _Download
  files ZIP_, per-artifact error lines when a fetch fails.
- **DiffView** — "Predicted XML vs the document fiskaly transmitted", side-by-side with
  _Pretty-print_ and _Ignore volatile ids & timestamps_ toggles, a changed-lines count, and — in
  MOCK — the permanent not-representative caveat.
- **Buttons** — _Send to fiskaly / Send again_, _Stop polling_ (disabled while the create call is
  in flight), _Keep polling_ (after timeout/stop), _Clear_, _Back to Validate_, and — after a
  transmitted send — **Done — start a new invoice**.

## The API log pane

Mounted beside Send and throughout the Test runner. Each call is a card: method, path, status pill
(colour by class), latency, persona and MOCK/LIVE chips, the record id, expandable request/response
with masked headers/bodies, prominent UAPI headers (`X-Api-Version`, `X-Idempotency-Key`,
`X-Trace-Identifier`, `X-Idempotency-Replayed`), and **Copy as cURL** (token placeholdered).
Repeated GET polls of the same record collapse into one card with a "polled n×" chip. Header:
call count, filter chips by step and persona, _Clear_ (view only — the backend keeps its history).
A warning strip appears if the live SSE stream disconnects; arriving at Send with a fresh session
clears the view so what you watch is this send.

## The Test runner

The second top-level section: replay the published fiskaly Postman collections (IT, BE, DE) through
the proxy. Left: the **EntityTree** — each persona's fiskaly account (organizations → subjects →
taxpayers → systems) with compliance-state glosses and guided provisioning where something is
missing. Right: the collection picker with version + notes count, the **variables** table (seeded
from config/entities, with source attribution and MOCK placeholders), and the step list — every
step with its method/path, captures, waits and asserts; non-runnable steps carry their skip reason
(tokens are the proxy's job, account mutations are skipped, the reception folder is skipped because
the app has no receive step). Controls: _Run all_, per-step _Run_/_Run from here_, _Stop_ (finishes
the current step), per-step and whole-run cURL export. In LIVE, _Run all_ first shows a
confirmation modal counting the records that will be created. A collapsible **notes** panel lists
the documented defects in the published collections, sent as published rather than silently fixed.

## Settings

A modal (focus-trapped, Esc closes) with sections:

- **Environment** — TEST/LIVE radio; LIVE requires ticking an explicit confirmation before _Apply
  environment_ enables.
- **Mode** — MOCK/LIVE radio (LIVE available only when seller credentials exist).
- **Credentials** — per persona, write-only: fields start empty, the response is only
  `configured` + a fingerprint (`sess***`); held in backend memory, never persisted (ADR-0005).
  A delete control clears session credentials.
- **Identifiers** — per-country system/taxpayer ids and the buyer's SDI destination code /
  Peppol id used by presets.
- **Validation rules** — the compiled rule sets and versions the Schematron stage runs.
- **Local preferences** — theme, layout reset.

## Accessibility, briefly

The panes are keyboard-first: roving tabindex in the field groups and findings list, focus-trapped
modals, `aria-live` status lines on every long-running surface, keyboard-resizable split dividers,
and every colour pairing drawn from the `--fsk-*` token system in light and dark.
