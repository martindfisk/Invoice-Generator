# frontend/public/sef provenance

Generated 2026-08-26T14:17:54Z by `frontend/scripts/build-sef.mjs` (`make sef`). Do not hand-edit.
Inputs come from `vendor/schematron/` (`make schemas`); see `vendor/SOURCES.md` for their pins.

SEF is tied to the SaxonJS major version - rebuild after upgrading `saxon-js`.
Built with saxon-js 2.7.0 (declared ^2.7.0), xslt3 2.7.0 (declared ^2.7.0).

| sef | build pipeline | rule set | licence | raw | gzip | sha256 | built |
|---|---|---|---|---|---|---|---|
| en16931-ubl.sef.json | EN16931-UBL-validation.xslt | CEN/TC 434 EN 16931 UBL 1.3.15 (last update 2025-10-16) | EUPL-1.2 (CEN/TC 434 validation artefacts) | 6.83 MB | 157 kB | 36b2f5aba2c51a61e406f714c8e08c256b5ae2e499d61e9db305d0f52f0f8281 | 2026-08-26 |
| en16931-cii.sef.json | EN16931-CII-validation.xslt | CEN/TC 434 EN 16931 CII 1.3.15 (last update 2025-10-16) | EUPL-1.2 (CEN/TC 434 validation artefacts) | 4.89 MB | 135 kB | f7f2b93667627619d70ccec27884c0615d629733479867b554690011cd84ddf8 | 2026-08-26 |
| peppol-ubl.sef.json | PEPPOL-EN16931-UBL.sch -> iso_svrl_for_xslt2.xsl | Peppol BIS Billing 3.0 - 2025 November release 3.0.20 | OpenPeppol AISBL (redistribution with attribution) | 1.86 MB | 64 kB | 45d9e9192e5cb60432194fcc87096c28bde033c4f3d6e477dd69d3b2e08b8ae3 | 2026-08-26 |
| cen-ubl.sef.json | CEN-EN16931-UBL.sch -> iso_svrl_for_xslt2.xsl | CEN/TC 434 EN 16931 UBL 1.3.15 (last update 2025-10-16) | EUPL-1.2 (CEN/TC 434), redistributed by OpenPeppol | 8.23 MB | 174 kB | b2170b512bcba0ab7cd6061a4832e451e86cf92f4c4b8362de84deea1b91b57e | 2026-08-26 |
| xrechnung-ubl.sef.json | XRechnung-UBL-validation.xsl | KoSIT XRechnung 3.0.2 UBL Schematron 2.5.0, compiled by SchXslt 1.10.1 / Saxon 12.8</skos:prefLabel> | Apache-2.0 (KoSIT xrechnung-schematron) | 1.83 MB | 61 kB | cc82c18b7928beec561de65606a11d8c574b377e775036f149adbb1b4d1dabf8 | 2026-08-26 |
| xrechnung-cii.sef.json | XRechnung-CII-validation.xsl | KoSIT XRechnung 3.0.2 CII"> Schematron 2.5.0, compiled by SchXslt 1.10.1 / Saxon 12.8</skos:prefLabel> | Apache-2.0 (KoSIT xrechnung-schematron) | 1.69 MB | 53 kB | 25d7690359f8ade3d3caf7bba197494bc72455dd89c7c079f75a8f6cdb2272e4 | 2026-08-26 |

## Sources

- `EN16931-UBL-validation.xslt` (sha256 c1caf4926947a3b6da52c8247dcf9e67ba4cf5fbd562bdf0528b2b8c51af2d0d)
  from https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/validation-1.3.15/en16931-ubl-1.3.15.zip
- `EN16931-CII-validation.xslt` (sha256 e55f1b01ffcbcc037dd1b9d01c52423a3f91f45a2e966e6bc8a56ea6c69188b6)
  from https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/validation-1.3.15/en16931-cii-1.3.15.zip
- `PEPPOL-EN16931-UBL.sch` (sha256 5ddf3a2f6633147b20b7805df9902d825af1a984f10014fcee186d4170364b1d)
  from https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/v3.0.20/rules/sch/PEPPOL-EN16931-UBL.sch
- `CEN-EN16931-UBL.sch` (sha256 bdcbb7b702cce55c7f8c789bef0cb9bebf6d376140c1776e683bd6d9bc0ad331)
  from https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/v3.0.20/rules/sch/CEN-EN16931-UBL.sch
- `XRechnung-UBL-validation.xsl` (sha256 0cadcbde2eb320c2e7e83a8057b93bc48076e223dda36308e31704684ee9ecf3)
  from https://github.com/itplr-kosit/xrechnung-schematron/releases/download/v2.5.0/xrechnung-3.0.2-schematron-2.5.0.zip
- `XRechnung-CII-validation.xsl` (sha256 ce8f257114eccb49d369a2c77c6cccd7d3cd9f1286e9ff158b543a1311182b2a)
  from https://github.com/itplr-kosit/xrechnung-schematron/releases/download/v2.5.0/xrechnung-3.0.2-schematron-2.5.0.zip

## Notes

- `.sch` inputs are compiled to XSLT 2.0 at build time with the vendored ISO Schematron
  skeleton. OpenPEPPOL publishes Schematron sources only - there is no `rules/xslt/` path in
  any `peppol-bis-invoice-3` tag - so this step replaces a download.
- `iso_dsdl_include.xsl` / `iso_abstract_expand.xsl` run only when the schema uses
  `<include>`/`<extends>` or abstract patterns: `iso_dsdl_include.xsl` recurses deeply enough
  to raise `RangeError: Maximum call stack size exceeded` in SaxonJS on a ~300 kB schema
  (it needs `ulimit -s 65520` + `node --stack-size=60000`). Both vendored rule sets are
  already flat, so only `iso_svrl_for_xslt2.xsl` runs today.
- `en16931-ubl.sef.json` and `cen-ubl.sef.json` are the same CEN rule set version from two
  distributions; they are not byte-identical (the Peppol copy carries a newer ISO 6523 ICD /
  EAS code list). Run `en16931-ubl` for plain EN 16931 and `cen-ubl` + `peppol-ubl` for the
  pair a Peppol access point applies.
- `xrechnung-ubl` / `xrechnung-cii` are KoSIT's own ready-compiled XSLT, produced with
  **SchXslt**, not the ISO skeleton. Their SVRL `svrl:failed-assert/@location` therefore uses
  the `/Q{uri}Name[n]` form instead of `/*:Name[namespace-uri()='uri'][n]`;
  `frontend/src/svrl.ts` normalises both into the project's prefixed path form.
- Never compile `.sch` at runtime; the browser only ever loads these SEF files.
- Each SEF embeds a `buildDateTime`, so a rebuild from identical inputs is not byte-identical.
  The SEF sha256 identifies the committed file; the source sha256 above is the pin that
  matters (and is re-verified by `make schemas`).

## SaxonJS browser runtime

`public/saxon/SaxonJS2.rt.js` is SaxonJS **2.7** (499 kB raw, 162 kB gzip),
copied verbatim from `vendor/saxon-js/` by this script together with `LICENSE.txt`.
The npm `saxon-js` package ships the Node build only, so the runtime comes from Saxonica;
its licence permits binary redistribution as part of an application when the copyright
notice travels with it - which is why `LICENSE.txt` is served next to it.
`schematron.worker.ts` `importScripts("/saxon/SaxonJS2.rt.js")` on first use.
