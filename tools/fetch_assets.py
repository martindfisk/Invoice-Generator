#!/usr/bin/env python3
import argparse
import hashlib
import io
import os
import sys
import urllib.error
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from fetch_spec import fetch

ROOT = Path(__file__).resolve().parents[1]
VENDOR = Path(os.environ.get("VENDOR_DIR", ROOT / "vendor"))
NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, OSError)

OASIS_BASE = "https://docs.oasis-open.org/ubl/os-UBL-2.1/xsdrt/"
UBL_LICENCE = "OASIS UBL 2.1 OS (2013-11-04), (c) OASIS Open 2013"
UBL_LOCAL_ROOTS = (
    Path(
        "/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Germany/"
        "xrechnung-3.0.2-bundle-2026-01-31/xrechnung-3.0.2-validator-configuration-2026-01-31/"
        "resources/ubl/2.1/xsd"
    ),
    Path(
        "/Users/martin.dutzler/Documents/GitHub/bodex/countries/"
        "e-invoicing (all countries)/de/standards_formats/"
        "xrechnung-3.0.2-bundle-2026-01-31/xrechnung-3.0.2-validator-configuration-2026-01-31/"
        "resources/ubl/2.1/xsd"
    ),
)
UBL_FILES = {
    "maindoc/UBL-Invoice-2.1.xsd": "3a5aacd823f0e5b8f25ae7b5191c2002d5333ba351d87de9371ed62dca2b2b0c",
    "maindoc/UBL-CreditNote-2.1.xsd": "1e117b6c1ab713604b29b0d685442a81a0c78a82575445ee8c43e6050cda7454",
    "common/CCTS_CCT_SchemaModule-2.1.xsd": "dd546e4809df86b6445589f69f0d6c9df162840ae386574ddfc1da7638103e15",
    "common/UBL-CommonAggregateComponents-2.1.xsd": "580b5af6f68f7f556bd15945ba0e819cbf561442c81694f9b9468036ebedec4d",
    "common/UBL-CommonBasicComponents-2.1.xsd": "a3b349bf92e5cff26e303d2f05b7e00c884dcafcfd9e12755fb80289abf5e22e",
    "common/UBL-CommonExtensionComponents-2.1.xsd": "ad7a4e490978adfbcfc5ec0bb20941cf11ac960ccf0c4de8791a7c731a8dbe87",
    "common/UBL-CommonSignatureComponents-2.1.xsd": "4fa9e2370100040fe14c43e135ef77e2eb66b21cb8dbfc2ffb8d82ae991fe92e",
    "common/UBL-CoreComponentParameters-2.1.xsd": "8be3379dbdcbcc7802fafdd16bac72c48fff1c0bb364213a31a17911dd06100b",
    "common/UBL-ExtensionContentDataType-2.1.xsd": "fcee77a11870208e6377ea6311b9f2a050bca24bdad8606ea02d71e9f9e72f8d",
    "common/UBL-QualifiedDataTypes-2.1.xsd": "7dcb156e610239c97ae70940cf4653b88e48c3595bf5f56a2204a32e2893e6cf",
    "common/UBL-SignatureAggregateComponents-2.1.xsd": "9234c2ca48dbfa9a22a786112bb075c5922a305170920eaab1e3c04fa0b7344b",
    "common/UBL-SignatureBasicComponents-2.1.xsd": "0fbe2d7afff0c1e11164b8ec83e13f18801021c3c87e390a9d76f9cf862f6a64",
    "common/UBL-UnqualifiedDataTypes-2.1.xsd": "09052d406b4293e2a5f9c2bfee6df10ad4d8d5f0b36e24a6349d7f7936d89eb6",
    "common/UBL-XAdESv132-2.1.xsd": "a4f726bcf8cc3f7d9ffa4dab99e005535a8e8b60dced1e5d94578d2e05afa96e",
    "common/UBL-XAdESv141-2.1.xsd": "1fa4625e9cefcb7a9abb5ac1b64315547450031eece8a55bd584e4ba4b79dbc1",
    "common/UBL-xmldsig-core-schema-2.1.xsd": "101909c9f06456d61ddcc4fb982f1d40dc357b439f393b1a2eb46e42acd60809",
}

FPA_PAGE = "https://www.fatturapa.gov.it/it/norme-e-regole/documentazione-fattura-elettronica/formato-fatturapa/"
FPA_HINT = f" (FatturaPA schemas: {FPA_PAGE})"
FPA_XSD_NAME = "Schema_VFPR12_v1.2.3.xsd"
FPA_XSD_URL = (
    f"https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.4/{FPA_XSD_NAME}"
)
FPA_XSD_SHA = "152944f6eef9f5d69ef6e955ee173b32142b00a8c1c5222fc97dfab5910e8a8c"
FPA_LICENCE = "fatturapa.gov.it copyright notice (all rights reserved; local personal-use storage only)"
FPA_TERMS = (
    "Ogni diritto sui contenuti (a titolo esemplificativo testi, immagini e architettura "
    "del sito) e' riservato ai sensi della normativa vigente. I contenuti delle pagine del sito "
    "non possono, ne' totalmente ne' in parte, essere copiati, riprodotti, trasferiti, caricati, "
    "pubblicati o distribuiti in qualsiasi modo senza il preventivo consenso scritto del Sistema "
    "di Interscambio, fatta salva la possibilita' di immagazzinarli nel proprio computer o di "
    "stampare estratti delle pagine di questo sito unicamente per utilizzo personale."
)
XMLDSIG_NAME = "xmldsig-core-schema.xsd"
XMLDSIG_URL = (
    "https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd"
)
XMLDSIG_SHA = "35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c"
XMLDSIG_LICENCE = "W3C Software and Document Notice and License"
GOBL_BASE = "https://raw.githubusercontent.com/invopop/gobl.fatturapa/main/schemas/"
GOBL_XSD_NAME = "FatturaPA_v1.2.2.xsd"
GOBL_XSD_SHA = "4c427d40ea3eadea4bd46e9f3379e401825cc610f3489c17c9e045b4310b971b"
GOBL_XMLDSIG_NAME = "xmldsig-core.xsd"
GOBL_LICENCE = "Apache-2.0 (invopop/gobl.fatturapa)"

CEN_VERSION = "1.3.15"
CEN_TAG = f"validation-{CEN_VERSION}"
CEN_RELEASES = "https://github.com/ConnectingEurope/eInvoicing-EN16931/releases"
CEN_UBL_ZIP_URL = f"{CEN_RELEASES}/download/{CEN_TAG}/en16931-ubl-{CEN_VERSION}.zip"
CEN_CII_ZIP_URL = f"{CEN_RELEASES}/download/{CEN_TAG}/en16931-cii-{CEN_VERSION}.zip"
CEN_XSLT_NAME = "EN16931-UBL-validation.xslt"
CEN_XSLT_SHA = "c1caf4926947a3b6da52c8247dcf9e67ba4cf5fbd562bdf0528b2b8c51af2d0d"
CEN_CII_XSLT_NAME = "EN16931-CII-validation.xslt"
CEN_CII_XSLT_SHA = "e55f1b01ffcbcc037dd1b9d01c52423a3f91f45a2e966e6bc8a56ea6c69188b6"
CEN_LICENCE = f"EUPL-1.2 (CEN/TC 434 validation artefacts {CEN_VERSION})"
CEN_CLONE = Path(
    "/Users/martin.dutzler/Documents/GitHub/bodex/countries/"
    "e-invoicing (all countries)/EN16931 standard"
)

XRECHNUNG_VERSION = "2.5.0"
XRECHNUNG_CIUS = "3.0.2"
XRECHNUNG_REPO = "https://github.com/itplr-kosit/xrechnung-schematron"
XRECHNUNG_TAG = f"v{XRECHNUNG_VERSION}"
XRECHNUNG_ZIP_URL = (
    f"{XRECHNUNG_REPO}/releases/download/{XRECHNUNG_TAG}/"
    f"xrechnung-{XRECHNUNG_CIUS}-schematron-{XRECHNUNG_VERSION}.zip"
)
XRECHNUNG_LICENCE = (
    f"Apache-2.0 (KoSIT / Koordinierungsstelle fuer IT-Standards, "
    f"xrechnung-schematron {XRECHNUNG_VERSION})"
)
XRECHNUNG_LOCAL_ROOTS = (
    Path(
        "/Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Germany/"
        f"xrechnung-{XRECHNUNG_CIUS}-bundle-2026-01-31/"
        f"xrechnung-{XRECHNUNG_CIUS}-schematron-{XRECHNUNG_VERSION}"
    ),
)
XRECHNUNG_FILES = {
    "XRechnung-UBL-validation.xsl": (
        "schematron/ubl/XRechnung-UBL-validation.xsl",
        "0cadcbde2eb320c2e7e83a8057b93bc48076e223dda36308e31704684ee9ecf3",
    ),
    "XRechnung-CII-validation.xsl": (
        "schematron/cii/XRechnung-CII-validation.xsl",
        "ce8f257114eccb49d369a2c77c6cccd7d3cd9f1286e9ff158b543a1311182b2a",
    ),
    "XRechnung-LICENSE.txt": (
        "LICENSE",
        "57e93bb611b8aeb93ff0f23b271a23291217b0016f6e66297dfd5e9467538a5f",
    ),
}

# The npm package "saxon-js" ships the Node build only (SaxonJS2N.js, requires fs/axios).
# The browser runtime is distributed by Saxonica outside npm; the licence (vendor/saxon-js/
# LICENSE.txt) permits redistribution in binary form as part of an application that uses it,
# provided the copyright notice is reproduced - only re-hosting it for third-party download
# (condition 4) is excluded. Keep the version in lockstep with devDependency "saxon-js":
# the SEF format is tied to the SaxonJS major version.
SAXON_VERSION = "2.7"
SAXON_ZIP_URL = f"https://downloads.saxonica.com/SaxonJS/2/SaxonJS-{SAXON_VERSION}.zip"
SAXON_LICENCE = (
    "Saxonica Ltd proprietary licence v1.0 (June 2020); binary redistribution "
    "permitted as part of an application, copyright notice must be reproduced"
)
SAXON_FILES = {
    "SaxonJS2.rt.js": (
        "saxon-js/SaxonJS2.rt.js",
        "7704990d3bfd64e6621ddf3939943be13a8cc20c17687e0f2dd1ca3d03434e88",
    ),
    "LICENSE.txt": (
        "saxon-js/LICENSE.txt",
        "73f09f080333cbf539c255dc55ea706a36f31e58ccd2c8f67929a995a768204f",
    ),
}

PEPPOL_TAG = "v3.0.20"
PEPPOL_RELEASE = "Peppol BIS Billing 3.0.20 (2025 November release)"
PEPPOL_REPO = "https://github.com/OpenPEPPOL/peppol-bis-invoice-3"
PEPPOL_BASE = (
    f"https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/"
    f"{PEPPOL_TAG}/rules/sch/"
)
PEPPOL_LICENCE = f"OpenPeppol AISBL, attribution required ({PEPPOL_TAG})"
PEPPOL_FILES = {
    "PEPPOL-EN16931-UBL.sch": "5ddf3a2f6633147b20b7805df9902d825af1a984f10014fcee186d4170364b1d",
    "CEN-EN16931-UBL.sch": "bdcbb7b702cce55c7f8c789bef0cb9bebf6d376140c1776e683bd6d9bc0ad331",
}

SKELETON_COMMIT = "72f7f7c9c46236f073bc59b60869b79528890fd0"
SKELETON_BASE = (
    f"https://raw.githubusercontent.com/Schematron/schematron/"
    f"{SKELETON_COMMIT}/trunk/schematron/code/"
)
SKELETON_LICENCE = "MIT (Schematron/schematron, Rick Jelliffe / Academia Sinica)"
SKELETON_FILES = {
    "iso_dsdl_include.xsl": "43ff20a1afd89d8a744d1c0b8df94ac5559ffa6a820d1ffbf508d6431ee4fdd9",
    "iso_abstract_expand.xsl": "c5267f124abf23eeb6669884e40a98607c055bfaa1f39e73b7d578feceeb6e46",
    "iso_svrl_for_xslt2.xsl": "0588d617924a0686255f6d182633d434c7986d561be8fcc3b363907d3f671b26",
    "iso_schematron_skeleton_for_saxon.xsl": "95f3195d9f437ea8ff5f75d1a27f4e68ae20b236fe0d4a217bb4209f498a10a3",
}

SYNTHETIC_EXAMPLE_NAME = "examples/synthetic-td01.xml"
SYNTHETIC_TD01 = """<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>01234567890</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>00001</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>ABC1234</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>01234567890</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>Alpha S.r.l.</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Roma 1</Indirizzo>
        <CAP>00100</CAP>
        <Comune>Roma</Comune>
        <Provincia>RM</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>09876543210</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>Beta S.p.A.</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Milano 2</Indirizzo>
        <CAP>20100</CAP>
        <Comune>Milano</Comune>
        <Provincia>MI</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-01-15</Data>
        <Numero>2026-001</Numero>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Servizio di consulenza</Descrizione>
        <Quantita>1.00</Quantita>
        <PrezzoUnitario>100.00</PrezzoUnitario>
        <PrezzoTotale>100.00</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>22.00</AliquotaIVA>
        <ImponibileImporto>100.00</ImponibileImporto>
        <Imposta>22.00</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <ImportoPagamento>122.00</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
"""


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def cached(path, sha):
    return path.exists() and sha256(path.read_bytes()) == sha


def store(path, data, sha, origin, hint=""):
    digest = sha256(data)
    if digest != sha:
        raise RuntimeError(
            f"{origin}: sha256 {digest} != pinned {sha}; upstream changed - "
            f"verify the source{hint} and update the pin in tools/fetch_assets.py"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def vendor_ubl(no_local):
    local_root = None
    if not no_local:
        local_root = next((root for root in UBL_LOCAL_ROOTS if root.is_dir()), None)
    if local_root:
        print(f"ubl-2.1: local bundle {local_root}")
    else:
        print(f"ubl-2.1: no local bundle, downloading from {OASIS_BASE}")
    rows = []
    for rel, sha in UBL_FILES.items():
        dest = VENDOR / "ubl-2.1" / "xsd" / rel
        url = OASIS_BASE + rel
        if cached(dest, sha):
            source, note = url, "cached"
        elif local_root and cached(local_root / rel, sha):
            store(dest, (local_root / rel).read_bytes(), sha, local_root / rel)
            source, note = str(local_root / rel), "copied"
        else:
            if local_root:
                print(
                    f"  {rel}: local copy missing or hash mismatch, downloading",
                    file=sys.stderr,
                )
            store(dest, fetch(url, timeout=60), sha, url)
            source, note = url, "downloaded"
        print(f"  {dest.relative_to(VENDOR)} [{note}]")
        rows.append((f"ubl-2.1/xsd/{rel}", source, UBL_LICENCE, sha))
    return rows


def fatturapa_official(fdir):
    rows = []
    dest = fdir / FPA_XSD_NAME
    if cached(dest, FPA_XSD_SHA):
        print(f"  fatturapa/{FPA_XSD_NAME} [cached]")
    else:
        store(dest, fetch(FPA_XSD_URL, timeout=60), FPA_XSD_SHA, FPA_XSD_URL, FPA_HINT)
        print(f"  fatturapa/{FPA_XSD_NAME} [downloaded]")
    rows.append((f"fatturapa/{FPA_XSD_NAME}", FPA_XSD_URL, FPA_LICENCE, FPA_XSD_SHA))
    xmldsig = fdir / XMLDSIG_NAME
    if cached(xmldsig, XMLDSIG_SHA):
        print(f"  fatturapa/{XMLDSIG_NAME} [cached]")
        rows.append(
            (f"fatturapa/{XMLDSIG_NAME}", XMLDSIG_URL, XMLDSIG_LICENCE, XMLDSIG_SHA)
        )
        return rows
    try:
        store(
            xmldsig, fetch(XMLDSIG_URL, timeout=60), XMLDSIG_SHA, XMLDSIG_URL, FPA_HINT
        )
        source = XMLDSIG_URL
    except NETWORK_ERRORS as exc:
        print(
            f"  w3.org unreachable ({exc}); fetching identical copy from gobl.fatturapa",
            file=sys.stderr,
        )
        source = GOBL_BASE + GOBL_XMLDSIG_NAME
        store(xmldsig, fetch(source, timeout=60), XMLDSIG_SHA, source, FPA_HINT)
    print(f"  fatturapa/{XMLDSIG_NAME} [downloaded]")
    rows.append((f"fatturapa/{XMLDSIG_NAME}", source, XMLDSIG_LICENCE, XMLDSIG_SHA))
    return rows


def fatturapa_gobl(fdir):
    rows = []
    for name, sha, licence in (
        (GOBL_XSD_NAME, GOBL_XSD_SHA, GOBL_LICENCE),
        (GOBL_XMLDSIG_NAME, XMLDSIG_SHA, GOBL_LICENCE),
    ):
        dest, url = fdir / name, GOBL_BASE + name
        if cached(dest, sha):
            print(f"  fatturapa/{name} [cached]")
        else:
            store(dest, fetch(url, timeout=60), sha, url, FPA_HINT)
            print(f"  fatturapa/{name} [downloaded]")
        rows.append((f"fatturapa/{name}", url, licence, sha))
    return rows


def vendor_fatturapa():
    fdir = VENDOR / "fatturapa"
    try:
        rows = fatturapa_official(fdir)
        keep = {FPA_XSD_NAME, XMLDSIG_NAME}
    except NETWORK_ERRORS as exc:
        print(
            f"WARNING: fatturapa.gov.it unreachable ({exc}); falling back to "
            "invopop/gobl.fatturapa (schema version 1.2.2, NOT the current 1.2.3)",
            file=sys.stderr,
        )
        rows = fatturapa_gobl(fdir)
        keep = {GOBL_XSD_NAME, GOBL_XMLDSIG_NAME}
    for stale in fdir.glob("*.xsd"):
        if stale.name not in keep:
            stale.unlink()
            print(f"  removed stale fatturapa/{stale.name}")
    example = fdir / SYNTHETIC_EXAMPLE_NAME
    data = SYNTHETIC_TD01.encode()
    if not cached(example, sha256(data)):
        example.parent.mkdir(parents=True, exist_ok=True)
        example.write_bytes(data)
    print(f"  fatturapa/{SYNTHETIC_EXAMPLE_NAME} [synthetic]")
    rows.append(
        (
            f"fatturapa/{SYNTHETIC_EXAMPLE_NAME}",
            "synthetic (embedded in tools/fetch_assets.py)",
            "this repository",
            sha256(data),
        )
    )
    return rows


def zip_member(url, member, hint):
    data = fetch(url, timeout=180)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        try:
            return zf.read(member)
        except KeyError:
            raise RuntimeError(
                f"{url}: member {member} missing; release layout changed{hint}"
            ) from None


def vendor_from_zip(vdir, prefix, files, url, licence, hint, local_roots, no_local):
    """Vendor pinned members of a release zip, preferring a byte-identical local copy."""
    rows = []
    for name, (member, sha) in files.items():
        dest = vdir / name
        if cached(dest, sha):
            print(f"  {prefix}{name} [cached]")
            rows.append((f"{prefix}{name}", url, licence, sha))
            continue
        local = None
        if not no_local:
            local = next(
                (root / member for root in local_roots if (root / member).is_file()),
                None,
            )
        if local and cached(local, sha):
            store(dest, local.read_bytes(), sha, local, hint)
            print(f"  {prefix}{name} [copied]")
            rows.append((f"{prefix}{name}", str(local), licence, sha))
            continue
        if local:
            print(
                f"  {name}: local copy hash mismatch, downloading {url}",
                file=sys.stderr,
            )
        store(dest, zip_member(url, member, hint), sha, url, hint)
        print(f"  {prefix}{name} [downloaded]")
        rows.append((f"{prefix}{name}", url, licence, sha))
    return rows


def vendor_saxon(no_local):
    print(f"saxon-js: SaxonJS {SAXON_VERSION} browser runtime ({SAXON_ZIP_URL})")
    return vendor_from_zip(
        VENDOR / "saxon-js",
        "saxon-js/",
        SAXON_FILES,
        SAXON_ZIP_URL,
        SAXON_LICENCE,
        " (https://www.saxonica.com/download/javascript.xml)",
        (),
        no_local,
    )


def vendor_pinned(sdir, files, base, licence, hint):
    rows = []
    for name, sha in files.items():
        dest, url = sdir / name, base + name
        if cached(dest, sha):
            print(f"  schematron/{name} [cached]")
        else:
            store(dest, fetch(url, timeout=60), sha, url, hint)
            print(f"  schematron/{name} [downloaded]")
        rows.append((f"schematron/{name}", url, licence, sha))
    return rows


def vendor_schematron(no_local):
    sdir = VENDOR / "schematron"
    print(
        f"schematron: CEN EN 16931 UBL+CII {CEN_VERSION}, {PEPPOL_RELEASE}, "
        f"XRechnung {XRECHNUNG_CIUS} Schematron {XRECHNUNG_VERSION}, "
        f"ISO skeleton @{SKELETON_COMMIT[:7]}"
    )
    return (
        vendor_from_zip(
            sdir,
            "schematron/",
            {CEN_XSLT_NAME: (f"xslt/{CEN_XSLT_NAME}", CEN_XSLT_SHA)},
            CEN_UBL_ZIP_URL,
            CEN_LICENCE,
            f" ({CEN_RELEASES})",
            (CEN_CLONE / "ubl",),
            no_local,
        )
        + vendor_from_zip(
            sdir,
            "schematron/",
            {CEN_CII_XSLT_NAME: (f"xslt/{CEN_CII_XSLT_NAME}", CEN_CII_XSLT_SHA)},
            CEN_CII_ZIP_URL,
            CEN_LICENCE,
            f" ({CEN_RELEASES})",
            (CEN_CLONE / "cii",),
            no_local,
        )
        + vendor_from_zip(
            sdir,
            "schematron/",
            XRECHNUNG_FILES,
            XRECHNUNG_ZIP_URL,
            XRECHNUNG_LICENCE,
            f" ({XRECHNUNG_REPO}/releases)",
            XRECHNUNG_LOCAL_ROOTS,
            no_local,
        )
        + vendor_pinned(
            sdir,
            PEPPOL_FILES,
            PEPPOL_BASE,
            PEPPOL_LICENCE,
            f" ({PEPPOL_REPO}/releases)",
        )
        + vendor_pinned(
            sdir,
            SKELETON_FILES,
            SKELETON_BASE,
            SKELETON_LICENCE,
            " (https://github.com/Schematron/schematron)",
        )
    )


def write_sources(rows):
    ts = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    fetched = ts[:10]
    lines = [
        "# vendor/ provenance",
        "",
        f"Generated {ts} by `tools/fetch_assets.py` (`make schemas`). Do not hand-edit.",
        "Every file is verified against the pinned sha256 on each run.",
        "",
        "| file | source | licence | sha256 | fetched |",
        "|---|---|---|---|---|",
    ]
    lines += [f"| {f} | {s} | {li} | {sha} | {fetched} |" for f, s, li, sha in rows]
    lines += [
        "",
        "## Notes",
        "",
        "- UBL 2.1 XSDs are the OASIS `xsdrt` (runtime) variant of UBL 2.1 OS; local copies from",
        "  the KoSIT XRechnung 3.0.2 validator-configuration bundle (2026-01-31) are byte-identical",
        f"  to {OASIS_BASE} (same sha256 pins).",
        f"- FatturaPA schema page: {FPA_PAGE} - section 'Documentazione valida dal 1 aprile 2025'",
        f"  lists `Schema_VFPA12_V1.2.3.xsd` and `{FPA_XSD_NAME}` (byte-identical, version 1.2.3,",
        "  technical specifications 1.9); `Schema_VFSM10v_1.0.2.xsd` (semplificata) is not vendored.",
        "- fatturapa.gov.it terms (https://www.fatturapa.gov.it/it/copyright/index.html):",
        f'  "{FPA_TERMS}"',
        "  All rights reserved; storage on one's own computer for personal use is permitted, but",
        "  redistribution is not - so the official AdE example files (e.g.",
        "  https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.2/IT01234567890_FPR01.xml)",
        "  are NOT vendored; a synthetic TD01 example is generated instead. vendor/ itself is",
        "  git-ignored and never redistributed.",
        "- Fallback source when fatturapa.gov.it is unreachable: invopop/gobl.fatturapa (Apache-2.0),",
        "  which ships schema version 1.2.2 (missing 1.2.3 additions such as TD29 and RF20).",
        "",
        "### Schematron rule sets (compiled to SEF by `frontend/scripts/build-sef.mjs`)",
        "",
        f"- CEN/TC 434 EN 16931 UBL validation artefacts **{CEN_VERSION}** (release `{CEN_TAG}`,",
        f"  {CEN_RELEASES}/tag/{CEN_TAG}). `{CEN_XSLT_NAME}` is the ready-compiled XSLT 2.0 shipped",
        f"  in `en16931-ubl-{CEN_VERSION}.zip`; the local clone copy is byte-identical (same pin).",
        f"  Upstream {CEN_VERSION} is not the newest release - 1.3.16 exists; bump deliberately.",
        f"- **{PEPPOL_RELEASE}**, tag `{PEPPOL_TAG}` ({PEPPOL_REPO}/releases/tag/{PEPPOL_TAG}).",
        "  That repository ships Schematron sources only (`rules/sch/`); there is no `rules/xslt/`",
        "  path in any tag, so the `.sch` is compiled to XSLT at SEF build time with the ISO",
        "  skeleton below. `CEN-EN16931-UBL.sch` inside the BIS release carries the same CEN",
        f"  version header ({CEN_VERSION}) as the standalone artefact above (`rules/sch/README.md`",
        "  claims 1.3.14.1 and is stale), but is not identical: the OpenPeppol copy ships a newer",
        "  ISO 6523 ICD / CEF EAS code list (adds 0245). Both are vendored so the two can be",
        "  compared and a Peppol access point's exact pair can be reproduced.",
        f"- CEN/TC 434 EN 16931 CII validation artefacts **{CEN_VERSION}**, same release, from",
        f"  `en16931-cii-{CEN_VERSION}.zip`. `{CEN_CII_XSLT_NAME}` is the ready-compiled XSLT 2.0;",
        "  the local clone copy is byte-identical (same pin).",
        f"- **XRechnung {XRECHNUNG_CIUS} Schematron {XRECHNUNG_VERSION}** (KoSIT / xeinkauf.de),",
        f"  release `{XRECHNUNG_TAG}` ({XRECHNUNG_REPO}/releases/tag/{XRECHNUNG_TAG}), Apache-2.0.",
        "  The release ships both `.sch` sources and ready-compiled `.xsl`; the `.xsl` is vendored",
        "  because it is the artefact KoSIT itself ships in the validator-configuration bundle.",
        f"  From {XRECHNUNG_VERSION} on the rules are compiled with **SchXslt**, not the ISO",
        "  skeleton, so the SVRL `@location` uses the `/Q{uri}Name[n]` form rather than",
        "  `/*:Name[namespace-uri()='uri'][n]` - `frontend/src/svrl.ts` normalises both.",
        f"- ISO Schematron 'skeleton' XSLT2 implementation, commit `{SKELETON_COMMIT}`",
        "  (https://github.com/Schematron/schematron, MIT). `iso_svrl_for_xslt2.xsl` imports",
        "  `iso_schematron_skeleton_for_saxon.xsl`, so both must sit in the same directory.",
        "",
        "### SaxonJS browser runtime",
        "",
        f"- **SaxonJS {SAXON_VERSION}** (`SaxonJS2.rt.js`, 499 kB) from {SAXON_ZIP_URL}.",
        "  The npm package `saxon-js` ships the Node build only (`SaxonJS2N.js`, requires `fs`),",
        "  so the browser runtime has to come from Saxonica directly. Keep it in lockstep with the",
        f"  `saxon-js` devDependency ({SAXON_VERSION}.x): SEF is tied to the SaxonJS major version.",
        "- Licence (`vendor/saxon-js/LICENSE.txt`, reproduced verbatim into `frontend/public/saxon/`",
        "  by `make sef`): Saxonica Ltd, version 1.0 (June 2020). It permits *redistribution in",
        "  binary form, without modification, as part of an application that makes use of the",
        "  Software*, on condition that the copyright notice and disclaimer are reproduced (1),",
        "  no reverse engineering (2), no endorsement by name (3), and that the software is not",
        "  copied *to a site whose primary purpose is to make it available to third parties* (4).",
        "  Serving it from this application's own `/saxon/` path so the Schematron worker can",
        "  `importScripts()` it is the permitted case; re-publishing it as a download is not.",
    ]
    (VENDOR / "SOURCES.md").write_text("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(
        description="Vendor UBL 2.1 / FatturaPA XSDs, the EN 16931 / Peppol / XRechnung "
        "Schematron rule sets and the SaxonJS browser runtime into vendor/ (make schemas)"
    )
    ap.add_argument(
        "--no-local",
        action="store_true",
        help="ignore local standards bundles and download everything",
    )
    args = ap.parse_args()
    try:
        rows = (
            vendor_ubl(args.no_local)
            + vendor_fatturapa()
            + vendor_schematron(args.no_local)
            + vendor_saxon(args.no_local)
        )
    except (*NETWORK_ERRORS, RuntimeError, ValueError) as exc:
        print(f"ERROR: asset vendoring failed: {exc}", file=sys.stderr)
        return 1
    write_sources(rows)
    print(f"vendor/: {len(rows)} assets, SOURCES.md written ({VENDOR})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
