# Test fixture provenance

Synthetic files (source: synthetic — written for this repository, no upstream):

| file | note |
|---|---|
| synthetic/fatturapa-td01.xml | minimal FPR12/TD01 invoice; validates against Schema_VFPR12_v1.2.3.xsd (FatturaPA schema 1.2.3, technical specifications 1.9) |
| synthetic/fatturapa-td01-broken.xml | same with mandatory DatiTrasmissione/ProgressivoInvio removed → one XSD error |
| synthetic/ubl-invoice-broken.xml | minimal UBL 2.1 invoice with cbc:ID / cbc:IssueDate order swapped → one XSD error |
| synthetic/ubl-creditnote-broken.xml | minimal UBL 2.1 credit note with mandatory cbc:ID removed → one XSD error |

CEN EN 16931 example files (EUPL-1.2) live in their own attributed directory: see `cen-en16931/SOURCES.md`.
