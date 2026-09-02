---
name: fatturapa-spec
description: FatturaPA (Italy, SDI) structure, mandatory fields, code lists (TD, RF, Natura, MP), SDI checks and notifications, legal basis and versions (specs 1.9 / 1.9.1). Load when writing or reviewing FatturaPA XML, SDI rules, Italian presets or Italian talking points.
---

# FatturaPA — Italy (Sistema di Interscambio)

Versions: technical specifications **1.9** (in force 1 Apr 2025) → **1.9.1** (usable from 15 May 2026); XML schema **1.2.3** — `Schema_VFPR12_v1.2.3.xsd` (B2B/B2C; `Schema_VFPA12_V1.2.3.xsd` for B2G is byte-identical), imports W3C `xmldsig-core-schema.xsd`. The older `Schema_del_file_xml_FatturaPA_*` file naming disappeared with 1.2.3. Vendored by `make schemas` into `vendor/fatturapa/` from `https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.4/`; namespace `http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2`, root `p:FatturaElettronica versione="FPR12"` (B2B/B2C) or `"FPA12"` (B2G). Official rendering: AdE stylesheet `fatturaordinaria_v1.2.x.xsl`. Note: fatturapa.gov.it content is "ogni diritto riservato" with only a personal-storage carve-out, so `vendor/` is git-ignored and official example invoices are NOT redistributed — synthetic examples are generated instead.

Legal basis: D.Lgs. 5 Aug 2015 n. 127 art. 1 c. 3 (B2B/B2C mandate from 1 Jan 2019 via L. 205/2017 art. 1 c. 909); Provvedimento AdE 30 Apr 2018 n. 89757 and amendments (technical rules); D.M. 55/2013 for B2G; flat-rate taxpayers included since 1 Jan 2024. Cross-border data via TD17/TD18/TD19 (esterometro replaced 1 Jul 2022).

## Structure (numbering = spec table)
- **1 FatturaElettronicaHeader**: 1.1 DatiTrasmissione (`IdTrasmittente{IdPaese, IdCodice}`, `ProgressivoInvio`, `FormatoTrasmissione` FPR12|FPA12, `CodiceDestinatario` 7 chars B2B / 6 chars B2G, `PECDestinatario` when code `0000000`); 1.2 CedentePrestatore (`DatiAnagrafici{IdFiscaleIVA{IdPaese,IdCodice}, CodiceFiscale?, Anagrafica{Denominazione | Nome+Cognome}, RegimeFiscale}`, `Sede{Indirizzo, NumeroCivico?, CAP, Comune, Provincia (IT only), Nazione}`, `IscrizioneREA{Ufficio, NumeroREA, CapitaleSociale?, SocioUnico?, StatoLiquidazione}` for companies); 1.3 RappresentanteFiscale?; 1.4 CessionarioCommittente (`DatiAnagrafici{IdFiscaleIVA? | CodiceFiscale?, Anagrafica}`, `Sede`); 1.5 TerzoIntermediario?; 1.6 SoggettoEmittente?.
- **2 FatturaElettronicaBody** (1..n): 2.1 DatiGenerali (`DatiGeneraliDocumento{TipoDocumento, Divisa, Data, Numero, DatiRitenuta?, DatiBollo?, ScontoMaggiorazione?, ImportoTotaleDocumento?, Causale?}`, `DatiOrdineAcquisto?`, `DatiFattureCollegate` for TD04); 2.2 DatiBeniServizi (`DettaglioLinee{NumeroLinea, Descrizione, Quantita?, UnitaMisura?, PrezzoUnitario, ScontoMaggiorazione?, PrezzoTotale, AliquotaIVA, Natura?, RiferimentoAmministrazione?}`; `DatiRiepilogo{AliquotaIVA, Natura?, ImponibileImporto, Imposta, EsigibilitaIVA I|D|S, RiferimentoNormativo (required with Natura)}` — one per Aliquota/Natura combination); 2.3 DatiVeicoli?; 2.4 DatiPagamento (`CondizioniPagamento` TP01 rate | TP02 completo | TP03 anticipo; `DettaglioPagamento{ModalitaPagamento, DataScadenzaPagamento?, ImportoPagamento, IBAN?, ...}`); 2.5 Allegati?.
- Amounts: 2 decimals (up to 8 for `PrezzoUnitario`/`Quantita`), dot decimal separator, no thousands separator; dates `YYYY-MM-DD`.

## Code lists (specs 1.9.1)
- `TipoDocumento`: TD01 fattura · TD02 acconto/anticipo su fattura · TD03 acconto su parcella · TD04 nota di credito · TD05 nota di debito · TD06 parcella · TD16 integrazione reverse charge interno · TD17 integrazione/autofattura acquisto servizi dall'estero · TD18 integrazione acquisto beni intracomunitari · TD19 integrazione/autofattura art. 17 c. 2 · TD20 autofattura regolarizzazione · TD21 autofattura splafonamento · TD22 estrazione beni da deposito IVA · TD23 estrazione con versamento IVA · TD24 fattura differita art. 21 c. 4 lett. a · TD25 fattura differita c. 4 terzo periodo lett. b · TD26 cessione beni ammortizzabili/passaggi interni · TD27 autoconsumo/cessioni gratuite · TD28 acquisti da San Marino con fattura cartacea · TD29 comunicazione omessa/irregolare fatturazione (new in 1.9).
- `RegimeFiscale`: RF01 ordinario · RF02 contribuenti minimi · RF04 agricoltura · RF05 sali e tabacchi · RF06 fiammiferi · RF07 editoria · RF08 telefonia pubblica · RF09 documenti di trasporto · RF10 intrattenimenti · RF11 agenzie viaggi · RF12 agriturismo · RF13 vendite a domicilio · RF14 beni usati · RF15 aste · RF16 IVA per cassa P.A. · RF17 IVA per cassa · RF18 altro · RF19 forfettario (L. 190/2014) · RF20 regime transfrontaliero di franchigia IVA (Dir. 2020/285, new in 1.9).
- `Natura` (only with AliquotaIVA 0): N1 escluse art. 15 · N2.1 non soggette artt. 7–7-septies · N2.2 non soggette altri casi · N3.1 non imponibili esportazioni · N3.2 cessioni intracomunitarie · N3.3 verso San Marino · N3.4 operazioni assimilate · N3.5 dichiarazioni d'intento · N3.6 altre non imponibili · N4 esenti · N5 regime del margine · N6.1 rottami · N6.2 oro/argento · N6.3 subappalto edile · N6.4 fabbricati · N6.5 telefoni cellulari · N6.6 prodotti elettronici · N6.7 edile e connessi · N6.8 energia/gas · N6.9 altri casi reverse charge · N7 IVA assolta in altro Stato UE (OSS).
- `ModalitaPagamento`: MP01 contanti · MP02 assegno · MP03 assegno circolare · MP04 contanti presso tesoreria · MP05 bonifico · MP06 vaglia cambiario · MP07 bollettino bancario · MP08 carta di pagamento · MP09 RID · MP10 RID utenze · MP11 RID veloce · MP12 RIBA · MP13 MAV · MP14 quietanza erario · MP15 giroconto contabilità speciale · MP16 domiciliazione bancaria · MP17 domiciliazione postale · MP18 bollettino c/c postale · MP19 SEPA Direct Debit · MP20 SEPA DD CORE · MP21 SEPA DD B2B · MP22 trattenuta su somme già riscosse · MP23 PagoPA.
- EN 16931 ↔ FatturaPA VAT mapping used in this project: S → AliquotaIVA > 0; Z/E/O → Natura N2.x/N4/N1; AE → N6.x; K → N3.2; G → N3.1.

## SDI controls to implement client-side (`fatturapa-rules.ts`, codes from the "elenco controlli" table)
00400 Natura required when AliquotaIVA = 0 (line) · 00401 Natura not allowed when AliquotaIVA ≠ 0 · 00403 Data later than reception date · 00404 duplicate invoice (same cedente, TipoDocumento, Numero, Data — SDI-side) · 00417 cessionario needs IdFiscaleIVA or CodiceFiscale · 00419 DatiRiepilogo missing for an Aliquota/Natura present on lines · 00420 EsigibilitaIVA S not allowed with Natura N6 · 00421 Imposta ≠ ImponibileImporto × AliquotaIVA/100 (±1 EUR tolerance) · 00422 ImponibileImporto ≠ Σ PrezzoTotale per Aliquota/Natura (±1) · 00423 PrezzoTotale ≠ PrezzoUnitario × Quantita ± ScontoMaggiorazione (±1 cent tolerance) · 00424 AliquotaIVA not expressed as percentage · 00425 Numero must contain at least one digit · 00426/00427 CodiceDestinatario length must match FormatoTrasmissione (FPA12 → 6, FPR12 → 7) · 00429 Natura required in DatiRiepilogo when AliquotaIVA 0 · 00430 Natura not allowed in DatiRiepilogo when AliquotaIVA ≠ 0 · 00471 cedente and cessionario must differ for TD01/TD02/TD03/TD06/TD16/TD17/TD18/TD19/TD20/TD24/TD25/TD28 · 00472 must be equal for TD21/TD27 · 00473 IdPaese of cedente must not be IT for TD17/TD18/TD19 · 00475 IdPaese of cessionario must be IT for TD17-TD19/TD28. Verify wording/tolerances against the current specs table before shipping a message.

## SDI notifications (lifecycle shown in the Send step)
RC ricevuta di consegna · NS notifica di scarto (rejected, codes above; must be re-issued within 5 days) · MC mancata consegna (made available in the buyer's reserved area) · AT attestazione di avvenuta trasmissione con impossibilità di recapito · NE notifica esito (B2G only: EC01 accepted / EC02 rejected) · DT decorrenza termini (B2G, 15 days). B2B buyers cannot accept/reject through SDI.

## References
`references/` (field table + XSD once vendored), fiskaly IT docs `meta/doc/unified/e-invoice/italy.md`, local spec PDF `/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Italy FatturaPA/Specifiche_tecniche_del_formato_FatturaPA_V1.4.pdf` (old), mapping `Outputted files/GOBL_to_FatturaPA_Field_Mapping.md`. Official: https://www.fatturapa.gov.it/it/norme-e-regole/documentazione-fattura-elettronica/formato-fatturapa/ , https://www.agenziaentrate.gov.it (specifiche tecniche 1.9.1).

## What the gateway actually does with the payload

`docs/reference/fatturapa/` holds a **real** `TRANSACTION::INVOICE` request and the FatturaPA XML
fiskaly's gateway generated from it (captured 2026-08-25), plus a field-by-field mapping. Read it
before changing `uapi-map.ts` or reasoning about what reaches the XML. The headline facts:

- A field you send has one of four fates: **mapped**, **not rendered** (accepted, no element),
  **discarded** (accepted then thrown away), or **platform** (comes from the Taxpayer/System, not
  the request).
- **`breakdown[]` and `totals` are discarded** — `DatiRiepilogo` is always recomputed server-side.
  They are still schema-*required* on an INVOICE operation. Both are true at once.
- The **seller's identity, address, RegimeFiscale and REA are platform**, from the Taxpayer entity.
  Only `seller.phone` and `seller.email` come from the request; `seller.name` is not rendered.
- `ModalitaPagamento` / `CondizioniPagamento` are derived defaults — the request has no field for
  either, so a model's MP/TP code cannot influence them.
