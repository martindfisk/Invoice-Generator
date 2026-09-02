# FatturaPA: what the gateway actually does with a `TRANSACTION::INVOICE`

**Provenance.** One real request posted through `POST /records` and the FatturaPA XML fiskaly's
gateway (GOBL → Invopop) generated from it, captured **2026-08-25** from a live response. Supplied
by the user as `fatturapa-field-mapping.html`, which was deleted afterwards — this directory is the
surviving record.

- `tested-payload.json` — the request, verbatim (re-indented; `record.id` was already a placeholder).
- `tested-response.xml` — the XML the gateway returned, unedited apart from reformatting.

Gateway internals it names: `src/unified/einvoicing/gobl/{invoice,entries,recipient}.go`,
`src/unified/einvoicing/fatturapa/fatturapa.go · ValidateInvoice`.

**Read this as one observation, not as the contract.** The spec in `spec/*.yaml` is the contract.
Where the two disagree, both are recorded below — that disagreement is itself the useful part.

## The rule that matters most

**Four different fates await a field you send.** Our Compose step presents the JSON as *the* artifact,
so a field that is silently discarded is actively misleading. The four categories:

| Fate | Meaning |
|---|---|
| **mapped** | reaches the XML |
| **not rendered** | accepted by the schema, produced no element |
| **discarded** | accepted, then thrown away by the generator |
| **platform** | not from the request at all — from the Taxpayer/System entity, or derived |

## Section by section

### DatiTrasmissione
`recipients[].invoicing.destination_code` (type `SDI`) → `CodiceDestinatario` — **mapped**.
`IdTrasmittente`, `ProgressivoInvio`, `FormatoTrasmissione` — **platform**. In the sample,
`ProgressivoInvio` was `00000026mY`; do not expect a predictable value.

### CedentePrestatore — the seller is *not* authored per invoice
Only contact details come from the request:
`seller.phone` → `Contatti/Telefono` and `seller.email` → `Contatti/Email` — **mapped**.
`seller.name` — **not rendered** (`Contatti` has no name element; BT-41 has nowhere to go).
`tax_representative.*` — **not rendered**; no `RappresentanteFiscale` block appeared.

`IdFiscaleIVA`, `Denominazione`, `RegimeFiscale`, `Sede`, `IscrizioneREA` — **platform**, from the
Taxpayer entity. This is why `uapi-map.ts` has `fromTaxpayer()` and why provisioning matters: the
seller identity on the invoice is whatever the commissioned taxpayer says, not what you compose.

### CessionarioCommittente
`recipients[].identification` (type `VAT`) → `IdFiscaleIVA`, `.name` → `Anagrafica/Denominazione`,
`.address` → `Sede` — all **mapped**. Note the observed `IdCodice` is the **bare** national number
(`82584750762`), consistent with our `nationalNumber()` stripping the country prefix.
`recipients[].buyer_id`, `.company_id`, `.shipping.*` — **not rendered** (no `DatiTrasporto` appeared).

### DatiGenerali — references
| Request field | Element | Fate |
|---|---|---|
| `document.number` | `Numero` | mapped |
| `document.issued_at` | `Data` | mapped *(see caveat)* |
| `payments[].details.currency` | `Divisa` | mapped |
| `references.purchase_order` | `DatiOrdineAcquisto` | mapped |
| `references.contract` | `DatiContratto` | mapped |
| `references.tender` | `DatiConvenzione` | mapped |
| `references.preceding_document` | `DatiFattureCollegate` (`IdDocumento` + `Data`) | mapped |
| `references.buyer`, `references.buyer_routing` | — | not rendered |
| `references.project` | — | not listed in the source table; fate unknown |
| `references.despatch_advice` | `DatiDDT` | source says "blocked / no such field" — **but see below** |

**Caveat on `issued_at`:** the tested payload does **not** contain `document.issued_at`, yet the XML
carries `<Data>2026-08-25</Data>` — the capture date. So `Data` was platform-defaulted here and the
"mapped" row is the author's expectation, not something this capture proves. We do send `issued_at`.

**Correction to the source on `despatch_advice`:** the spec at `2026-06-01` *does* define
`DocumentReferences.despatch_advice` (verified in `spec/fiskaly.uapi.e-invoice-it.2026-06-01.yaml`,
`components.schemas.DocumentReferences`). The tested payload never sends it, so this capture is not
evidence of rejection. Treat it as **accepted by the schema, unproven whether it renders `DatiDDT`**.

`AltriDatiGestionali` with `TipoDato="N.DOC.COMM"` — **not implemented** by the gateway. Relevant
because that is the FAQ-45 route for linking a commercial document, and `preceding_document` gives a
generic linked-invoice reference instead.

### DatiBeniServizi — your VAT summary is thrown away
`entries[].data.text` → `Descrizione`, `.unit.quantity` → `Quantita`,
`.unit.price`/`value.base` → `PrezzoUnitario`/`PrezzoTotale`, `.vat.percentage` → line `AliquotaIVA`
— all **mapped**, though amounts are **recomputed and reformatted** (`Quantita` came back
`1.00000000`, `PrezzoUnitario` `100.0000`).

**`breakdown[]` and `totals` are discarded — `DatiRiepilogo` is always recomputed server-side.**
They are still *schema-required* on an `INVOICE` operation (`Totals` in the spec says required), so
you must send them and they will be ignored. Both statements are true at once.

`entries[].data.product` and `entries[].details.*` except `concept` — **discarded**. We currently
send `details.description` and `details.number`; both go nowhere.

### DatiPagamento
`payments[].details.date` (on `OUTSTANDING`) → `DataScadenzaPagamento`, `.details.amount` →
`ImportoPagamento`, `.instruction.name` → `IstitutoFinanziario`, `.instruction.account` → `IBAN`,
`.instruction.payment_service_provider` → `BIC` — **mapped**. The BIC must be a real SWIFT/BIC.
`ModalitaPagamento` and `CondizioniPagamento` — **platform**, derived defaults (`MP05`/`TP02` here);
the request has no field for either, so our model's `payment.italianMeansCode` and `payment.conditions`
cannot influence them.
`payments[].details.discount` and `payments[].concept` — **discarded**.

## Shape details worth copying

- `entries[].data.unit.measure` is **free text** — `"unit"` in the sample. Not a UN/ECE code list.
- `entries[].data.unit.factor` is sent as `"1"`.
- `entries[].data.value` carries `discount` and `surcharge` as `"0.00"` — we have no model field for
  line-level allowance/charge (EN 16931 BT-136/BT-141), a known gap.
- `entries[].details.concept` is `"SERVICE"` for a service line (we emit `"GOOD"` unless the unit is
  hours).
- Every money value is a **decimal string**, never a number.
