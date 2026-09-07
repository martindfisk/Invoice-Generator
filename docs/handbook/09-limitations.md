# 09 — What the tool knows it cannot do

The app's most distinctive feature is negative knowledge: wherever a field, an edit or a result
cannot be trusted, the UI says so _by name_, with the evidence. This chapter collects the five
mechanisms in one place — they are separately implemented but share one ethos: **a demo that
flatters is worse than no demo.**

## Field fates (gateway evidence)

The fiskaly operation schema accepting a field proves nothing about the transmitted XML. The fate
table (`frontend/src/uapi-field-fate.ts`) records what the gateway _actually did_ with each field
in one real captured exchange — request and returned FatturaPA XML, 2026-08-25, kept verbatim in
[docs/reference/fatturapa/](../reference/fatturapa/README.md):

| Fate             | Meaning                                                                   | Canonical example                                                         |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **mapped**       | reaches the XML                                                           | `recipients[].invoicing.destination_code` → `CodiceDestinatario`          |
| **not rendered** | accepted; produces no element                                             | `seller.name` — `Contatti` has no name element, BT-41 has nowhere to go   |
| **discarded**    | accepted, then thrown away by the generator                               | `breakdown[]`/`totals` — schema-**required**, then recomputed server-side |
| **platform**     | comes from the Taxpayer/System entity or is derived, not from the payload | `Denominazione`, `RegimeFiscale`, `ProgressivoInvio`, `ModalitaPagamento` |

Epistemics: one observation, not the contract; scoped to the Italian path; an absent pointer means
_no evidence_, never _safe_; where the capture proves nothing (e.g. `issued_at` was
platform-defaulted that day) the doc says so rather than extrapolating. Rendered as fate marks in
the Mapper and as tables in [04](04-mapping-reference.md#field-fates-fatturapa-gateway-evidence).

## Lossy edits

Both free-text panes measure whether the model can carry your edit: after parsing,
`write(parse(text)) !== text` (XML) or the equivalent `operationIsLossy` (JSON) marks the edit
**lossy**. Nothing is blocked — but the moment a later edit forces regeneration, a persistent
notice states that part of your hand edit was dropped and where to re-apply it. The declared loss
tables (`UAPI_LOSSY_FIELDS`, `UAPI_PARTIAL_FIELDS`) power the same honesty statically: the
PresenceStrip quotes their verbatim reasons for the selected field.

## The gap report (`docs/gaps/`)

The systematic version of the loss tables: `make gap-report` folds the mapping tables, the loss
tables and the spec field catalogue into a per-field report of what each **mandated syntax**
requires but the model/JSON/XML cannot carry (335 rows currently; e.g. seller BG-4 coming from the
taxpayer resource, document-level allowances, bank details outside `CREDIT_TRANSFER`). Every row's
`reason` is quoted verbatim from a declared table so `make gap-check` can prove nothing was
paraphrased. It is scoped to each country's mandated syntax. The current report grades no row
`blocking` (171 should-fix, the rest notes), so the methodological caveat about applying EN 16931
cardinality to FatturaPA (which is _not_ a CIUS of EN 16931) appears in the generated README only
when blocking rows exist; the `/gap-audit` verdicts are the place that question gets settled.

## Known engine defects

When a validation engine is provably wrong, the finding is corrected _transparently_.
`known-defects.ts` currently holds one entry: SaxonJS 2.7 computes `xs:integer mod` in IEEE-754
doubles, so the IBAN mod-97 rules (EN 16931 BR-DE-19 / XRechnung DE-R-019) misfire above 2⁵³. The
app re-verifies the IBAN exactly (BigInt) and downgrades **only provably-false** findings to
`info`, appending a note naming the engine defect — the finding stays visible, re-explained, never
deleted.

## Persistence migrations drop old work

The saved-workflow format is versioned (`VIEW_VERSION` in `frontend/src/workflow.ts`). A blob from
an older version restores only the cosmetics — preset, step, pane layout — and silently drops the
saved invoice edits and send state, because pre-current shapes are not trusted enough to rehydrate.
The same applies to a legacy bare-string correction target (it lacks the country/mode context the
mismatch guards need). One-time cost per format bump, taken deliberately over migration code for a
demo tool.

## The MOCK diff caveat

In MOCK mode the "transmitted" artifact is a static fixture with only the invoice number and total
patched in — so the DiffView's changed lines are mostly fixture noise, not fiskaly rewriting your
invoice. The diff therefore carries a permanent banner saying exactly that, and that the comparison
is only meaningful in LIVE. The one comparison MOCK _can_ make honestly — the lifecycle, the call
shapes, the state machine — is real, because mock and live share the client code.

## Where each limitation surfaces

| Mechanism     | In the UI                                                                       | In the docs                                                |
| ------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Field fates   | JSON-pane underlines + legend, CoveragePanel "Insert anyway — …", PresenceStrip | [04](04-mapping-reference.md), `docs/reference/fatturapa/` |
| Lossy edits   | Dismissible regeneration notices, PresenceStrip reasons                         | [03](03-mappings.md), [05](05-mapper.md)                   |
| Gap report    | (tooling output, not in-app)                                                    | `docs/gaps/README.md` + CSV/JSON                           |
| Known defects | Downgraded finding with explanatory note, rule-set versions in the stage row    | [06](06-validation.md)                                     |
| MOCK caveat   | Banner on the DiffView, MOCK badges throughout                                  | [07](07-send-and-backend.md#the-mock)                      |

Finally, the guided walkthrough: [10 — Screen-by-screen tour](10-tour.md).
