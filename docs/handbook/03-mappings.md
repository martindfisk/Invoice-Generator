# 03 — Mappings

One model, five renderings: four XML formats (FatturaPA, Peppol BIS 3.0 UBL, XRechnung, CII) and
the fiskaly JSON operation. This chapter explains the machinery; the complete field-by-field lookup
is the generated [04 — Mapping reference](04-mapping-reference.md).

## Mapping tables are data

The core pattern of the whole serialisation layer: **a mapping is a table row, not code.**

```ts
export type MappingRow = {
  field: FieldId; // canonical model address ("" = a constant of the format)
  path: string; // document path, e.g. "Invoice/cbc:ID" or "FatturaElettronicaBody/…"
  bt?: string; // EN 16931 business term, e.g. "BT-1"
  fpa?: string; // FatturaPA block reference (specs 1.9.1)
  label: string; // human meaning, shown as tooltip text
};
```

Each format contributes one table (`UBL_MAP`, `FATTURAPA_MAP`, `CII_MAP`; `XRECHNUNG_MAP` is
_derived from_ `UBL_MAP` — XRechnung is a CIUS of the same UBL syntax, so it transforms the UBL
rows instead of duplicating them). The writers emit elements **through** the rows — a writer calls
`el(row, value)` rather than naming a path itself — so three things can never drift apart:

1. the XML the writer produces,
2. the tooltip/badge the UI shows for a field (BT id, FPA block, label),
3. the path index that cross-highlighting and finding-resolution use ([05](05-mapper.md)).

Change a row and all three change together; that is the invariant the golden-fixture tests pin.

## Writers and parsers: two-way by construction

Every format has `write(invoice): xml` **and** `parse(xml): Invoice`. Two-way matters because the
XML pane is editable: a hand edit is parsed back into the model, and the writers regenerate the
other panes. The **lossiness test** falls out naturally: after parsing your edit, the app re-writes
the invoice and compares — if `write(parse(text)) !== text`, your edit contained something the
mapping table cannot carry, and the UI says so instead of silently dropping it
([05](05-mapper.md#editing), [09](09-limitations.md#lossy-edits)).

`xml-writer.ts` is the shared low-level emitter (elements, namespaces, escaping); the per-format
`*-write.ts` files hold the structure and the table calls. Round-trip fidelity is enforced by the
golden tests: every preset is serialised, re-parsed and deep-compared, and the golden XML files
under `frontend/tests/golden/` pin the exact output.

### The prediction is fiskaly's document, not ours

The XML pane is labelled _predicted_ — what fiskaly will generate — not _our_ document. Before
writing, `transmittable.ts` **blanks the fields the operation provably cannot deliver** (per the
loss tables below), so the prediction never shows an element that cannot survive the trip. Without
this, the predicted XML would flatter the model.

### The running example in two syntaxes

Line 3 of `it-b2b-sdi` (the dichiarazione-d'intento line) renders in FatturaPA as:

```xml
<DettaglioLinee>
  <NumeroLinea>3</NumeroLinea>
  <Descrizione>Fornitura con dichiarazione d'intento</Descrizione>
  …
  <AliquotaIVA>0.00</AliquotaIVA>
  <Natura>N3.5</Natura>
  <AltriDatiGestionali>
    <TipoDato>INTENTO</TipoDato>
    <RiferimentoTesto>08060120345678901-000001</RiferimentoTesto>
    <RiferimentoData>2026-01-15</RiferimentoData>
  </AltriDatiGestionali>
</DettaglioLinee>
```

Switch the same invoice to UBL and the line becomes an `InvoiceLine` with
`ClassifiedTaxCategory ID="E"` and a document-level exemption reason — same model, two national
grammars. The Natura ↔ EN 16931 category correspondence is itself a table
(`NATURA_CATEGORY` in `fatturapa-map.ts`): N1→E, N2.x→O, N3.5→E, N6.x→AE (reverse charge), and so
on — a genuinely lossy many-to-one mapping, which is why the model stores _both_ the category and
the natura.

## The fiskaly JSON operation (`uapi-map.ts`)

The operation is the payload `POST /records` actually accepts — `{type: "INVOICE", document,
entries[], recipients[], payments[], breakdown[], totals…}`. It is **not** produced from a row
table: `toInvoiceTransaction(invoice)` builds it structurally, because the operation's shape (typed
entries, instruction/details splits, recipient blocks) doesn't decompose into flat path pairs. The
inverse, `applyOperation`/`fromInvoiceTransaction`, reads a hand-edited JSON back into the model —
the JSON pane is as editable as the XML pane, with the same lossiness test
(`operationIsLossy`).

Around the structural core sit three declared tables (all rendered in [04](04-mapping-reference.md)):

- **`UAPI_POINTER_FIELDS`** — operation pointers that map to `uapi.*` model fields, i.e. things
  that exist _because the API offers them_ (`/document/series` → `uapi.series`,
  `/entries/{i}/data/product/code` → `lines.{i}.uapi.itemCode`, shipping blocks, …).
- **`UAPI_LOSSY_FIELDS`** — model fields the operation **cannot carry at all**, grouped under a
  verbatim reason string. The reasons are quoted, not paraphrased, everywhere they surface
  (PresenceStrip, gap report) so the claim is auditable.
- **`UAPI_PARTIAL_FIELDS`** — carried, but incompletely (e.g. a reference that loses its date).

Two operation facts shape everything downstream:

- **The seller is not authored per invoice.** `CedentePrestatore` comes from the commissioned
  Taxpayer entity on the fiskaly account (`fromTaxpayer()` exists for exactly this); what you type
  into `seller.*` mostly cannot reach the XML. This is the fate class **platform**.
- **`breakdown[]` and `totals` are schema-required and then discarded** — the gateway recomputes
  `DatiRiepilogo` server-side. Both statements are true at once; the UI carries a note saying so.

### Corrections

`buildOperation(invoice, correctionTarget)` wraps a credit note (`typeCode 381`) into a
`TRANSACTION::CORRECTION` — `{type: "CORRECTION", record: {id: <the transmitted invoice>}, data:
<the invoice operation>}` — when a correction target exists (the last invoice this browser
transmitted). Until then the JSON pane shows the future `data` block and Send is blocked with an
explanation ([07](07-send-and-backend.md#corrections)).

## Field fates: evidence, not hope

The operation schema accepting a field says nothing about the field reaching the transmitted XML.
The **fate table** (`uapi-field-fate.ts`) records what fiskaly's gateway _actually did_ with each
field in one real captured exchange (2026-08-25, kept verbatim in `docs/reference/fatturapa/`):
**mapped**, **not-rendered**, **discarded**, or **platform**. Scope: the Italian path only; absence
of an entry means _no evidence_, never _safe_. The Mapper draws these as dotted underlines on the
JSON ("fate marks"); the full table is in [04](04-mapping-reference.md#field-fates-fatturapa-gateway-evidence)
and the epistemics in [09](09-limitations.md).

## The format-plugin seam

`formats.ts` is the registry: each plugin declares `{id, label, map, write, parse, xsdSchemaKey,
validationStages, unsupportedReason}`. The UI derives everything from it — the format switch offers
whatever serialises, validation runs whatever stages the plugin declares, and a declared
`unsupportedReason` (today: UBL/XRechnung `CreditNote` output) blocks a rendering honestly instead
of failing weirdly. Adding a format touches the registry and its own `*-map/write/parse` files,
nothing else.

Next: the generated lookup — [04 — Mapping reference](04-mapping-reference.md) — or how the panes
use all this: [05 — The Mapper](05-mapper.md).
