# 02 — The invoice model

Everything in the app works on **one canonical invoice** (`frontend/src/model.ts`). The Mapper
edits it, four format writers serialise it, the JSON operation is derived from it, every validation
stage judges it or one of its renderings. Formats come and go at the edges; the model is the fixed
point.

## Shape

```ts
export type Invoice = {
  format: FormatId; // which syntax the preset "belongs" to (the viewer can switch)
  number: string; // BT-1
  issueDate: string; // BT-2 (ISO date)
  dueDate?: string; // BT-9
  typeCode: "380" | "381"; // BT-3 — UNCL1001: commercial invoice | credit note
  currency: string; // BT-5 — ISO 4217
  note?: string; // BT-22
  references?: References; // BT-10..BT-17 — buyer/order/contract/project/despatch refs
  it?: ItalianDocument; // Italian-only document extras (bollo, ritenuta, causale …)
  seller: Party; // BG-4
  buyer: Buyer; // BG-7 + the routing channel (below)
  delivery?: Delivery; // BG-13/BG-15
  lines: Line[]; // BG-25
  vatBreakdown: VatBreakdownRow[]; // BG-23
  payment: Payment; // BG-16/BT-20
  totals: Totals; // BG-22
  uapi?: UapiExtras; // fields that exist only because the fiskaly operation offers them
};
```

The design rule: the model carries the **union** of what the supported formats and the fiskaly
operation can express, labelled with EN 16931 business terms wherever one applies. Where a format
needs something the core standard has no term for, the model gets a namespaced pocket —
`it.*` for FatturaPA document-level extras, per-line `lines[i].it.*` (e.g.
`altriDatiGestionali`), and `uapi.*` / `lines[i].uapi.*` for operation-only fields. That keeps the
core clean and makes provenance visible in the field id itself.

### The routing channel

Who receives the invoice, and over which rail, is a first-class model concept:

```ts
export type Channel =
  | { kind: "SDI"; codiceDestinatario: string; pec?: string } // Italy — via SDI
  | { kind: "PEPPOL"; participantId: string } // e.g. 0208:<KBO>, 0204:<Leitweg-ID>
  | { kind: "EMAIL"; email: string; format?: "ZUGFERD_V2" | "XRECHNUNG_V3" };
```

The channel drives model rules (an SDI channel demands a valid destination code or a PEC), the
FatturaPA `DatiTrasmissione` block, the UBL endpoint identifiers, and the `recipients[].invoicing`
block of the fiskaly operation.

## Field addressing: `FieldId`

Every field has a stable dot-path id: `"number"`, `"seller.address.city"`,
`"lines.2.netAmount"`, `"lines.0.uapi.itemCode"`. `getField`/`setField` in `model.ts` resolve these
paths generically (arrays by index, immutably on write). This one addressing scheme is what glues
the app together:

- mapping rows pair a `FieldId` with an XML path ([03](03-mappings.md)),
- the selection object carries a `FieldId` so all three Mapper panes highlight the same thing
  ([05](05-mapper.md#selection)),
- findings resolve to a `FieldId` so clicking a validation error focuses the field
  ([06](06-validation.md#findings)),
- the loss and fate tables name `FieldId`s so a limitation always points at something concrete.

A `{i}` segment in a table generalises over the index: `lines.{i}.netAmount` matches
`lines.0.netAmount`, `lines.1.netAmount`, …

## Decimal money

**Money never touches a float.** Amounts are decimal strings end to end, and `decimal.ts` is the
only arithmetic allowed on them: `add/sub/mul/sum`, `cmp/eq/isZero`, `round/format` (half-up by
default), `percentOf`. The reason is the standard itself: EN 16931's calculation rules (the BR-CO
series, e.g. BR-CO-10: Σ line net amounts = BT-106) demand exact decimal identities, and
`0.1 + 0.2 !== 0.3` in IEEE-754 would manufacture false findings. The same convention continues
outward: the fiskaly operation serialises every amount as a JSON string, and the observed gateway
behaviour reformats but never re-types them.

## Model rules

`model-rules.ts` is the first validation tier ([06](06-validation.md)) and runs synchronously on
every edit. Its checks are the arithmetic and consistency constraints that live naturally on the
model rather than in any syntax: Σ line nets = BT-106, the VAT breakdown must partition the lines
by (category, rate), each breakdown row's tax = taxable × rate within ±0.01 (EN 16931 BR-CO-17
tolerance), and channel constraints (SDI destination-code shape, B2G six-character codes, PEC
requirements).

## Presets

`presets.ts` ships eleven scenarios in three groups — reference cases (IT/BE), a Munich hotel
group (ZUGFeRD/XRechnung, Germany) and Roman restaurant cases (FatturaPA, incl. an FPA12 B2G and a
TD04 credit note). Presets are plain `Invoice` values: picking one loads it, and every later step
works on that object. Deliberately defective presets ("broken on purpose") exist for the error
demos; Setup marks them by running the model rules against each preset and by a wording heuristic.

## The running example: `it-b2b-sdi` — "Italian B2B (SDI)"

The handbook's example throughout. A domestic Italian B2B invoice, `typeCode 380`, currency EUR,
channel `SDI / ABC1234`, three lines chosen to exercise three different VAT treatments:

| #   | Line                                                                            | Qty × price     | Net     | VAT                     |
| --- | ------------------------------------------------------------------------------- | --------------- | ------- | ----------------------- |
| 1   | Servizio di consulenza (+ `uapi.itemNumber/itemCode` extras)                    | 10 HUR × 150.00 | 1500.00 | S 22 %                  |
| 2   | Manuale operativo stampato                                                      | 20 H87 × 25.00  | 500.00  | S 10 %                  |
| 3   | Fornitura con dichiarazione d'intento (+ line `it.altriDatiGestionali` INTENTO) | 1 C62 × 800.00  | 800.00  | E 0 % — natura **N3.5** |

The VAT breakdown has three matching rows (S/22 → 330.00 tax, S/10 → 50.00, E/0 → 0.00 with
natura N3.5 and its exemption note); the totals follow by the BR-CO identities. Line 3 is the
domain-rich one: an Italian _dichiarazione d'intento_ exemption, which FatturaPA expresses as
Natura `N3.5` **plus** an `AltriDatiGestionali` block carrying the declaration protocol — a
construct EN 16931 has no term for, which is exactly why it lives under `lines[i].it.*` — and why
the curated SDI rule set in [06](06-validation.md) checks Natura ↔ Aliquota consistency (00400/00401
family) rather than trusting the syntax alone.

Follow the same invoice into its serialisations: [03 — Mappings](03-mappings.md).
