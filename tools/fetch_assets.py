#!/usr/bin/env python3
import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import urllib.error
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from fetch_spec import fetch

ROOT = Path(__file__).resolve().parents[1]
VENDOR = Path(os.environ.get("VENDOR_DIR", ROOT / "vendor"))
MANIFEST = Path(__file__).with_name("rulesets.json")
NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, OSError)

FPA_HINT_LABEL = "FatturaPA schemas: "
FPA_TERMS = (
    "Ogni diritto sui contenuti (a titolo esemplificativo testi, immagini e architettura "
    "del sito) e' riservato ai sensi della normativa vigente. I contenuti delle pagine del sito "
    "non possono, ne' totalmente ne' in parte, essere copiati, riprodotti, trasferiti, caricati, "
    "pubblicati o distribuiti in qualsiasi modo senza il preventivo consenso scritto del Sistema "
    "di Interscambio, fatta salva la possibilita' di immagazzinarli nel proprio computer o di "
    "stampare estratti delle pagine di questo sito unicamente per utilizzo personale."
)

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


# --- manifest (tools/rulesets.json) -------------------------------------------------------


def load_manifest(path=MANIFEST):
    return json.loads(Path(path).read_text())


def save_manifest(data, path=MANIFEST):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def source_by_id(data, source_id):
    for src in data["sources"]:
        if src["id"] == source_id:
            return src
    known = ", ".join(s["id"] for s in data["sources"])
    raise RuntimeError(
        f"unknown source {source_id!r} in tools/rulesets.json (known: {known})"
    )


def template_vars(src):
    return {"version": src.get("version", ""), **src.get("vars", {})}


def render(template, src, **extra):
    try:
        return template.format(**template_vars(src), **extra)
    except KeyError as exc:
        raise RuntimeError(
            f"template {template!r} of source {src['id']}: no value for {exc}"
        ) from None


def source_url(src, file):
    return render(src["urlTemplate"], src, file=file)


def source_licence(src):
    return render(src["licence"], src)


def source_files(src):
    """Rendered (name, sha256, zip_name, member) per file; zip_name/member are None for raw."""
    out = []
    for name, value in src["files"].items():
        rendered = render(name, src)
        if isinstance(value, str):
            out.append((rendered, value, None, None))
        else:
            out.append(
                (rendered, value["sha256"], render(value["zip"], src), value["member"])
            )
    return out


def source_hint(src):
    if src["id"] == "fatturapa":
        return f" ({FPA_HINT_LABEL}{src['homepage']})"
    return f" ({src['homepage']})"


# --- local standards bundles (STANDARDS_DIRS) ---------------------------------------------


def dotenv_value(key):
    env_file = ROOT / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}="):
            return stripped.split("=", 1)[1].strip().strip("'\"")
    return None


def standards_dirs():
    raw = os.environ.get("STANDARDS_DIRS")
    if raw is None:
        raw = dotenv_value("STANDARDS_DIRS")
    if not raw:
        return []
    return [Path(part).expanduser() for part in raw.split(os.pathsep) if part.strip()]


def local_roots(src, no_local):
    if no_local:
        return []
    return [
        base / render(subdir, src)
        for base in standards_dirs()
        for subdir in src.get("localSubdirs", [])
    ]


# --- pinned download/verify/store core (unchanged) ----------------------------------------


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def cached(path, sha):
    return path.exists() and sha256(path.read_bytes()) == sha


def store(path, data, sha, origin, hint=""):
    digest = sha256(data)
    if digest != sha:
        raise RuntimeError(
            f"{origin}: sha256 {digest} != pinned {sha}; upstream changed - "
            f"verify the source{hint} and update the pin in tools/rulesets.json"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def vendor_ubl(manifest, no_local):
    src = source_by_id(manifest, "ubl")
    base = source_url(src, "")
    local_root = next(
        (root for root in local_roots(src, no_local) if root.is_dir()), None
    )
    if local_root:
        print(f"ubl-2.1: local bundle {local_root}")
    else:
        print(f"ubl-2.1: no local bundle, downloading from {base}")
    rows = []
    for rel, sha, _zip, _member in source_files(src):
        dest = VENDOR / "ubl-2.1" / "xsd" / rel
        url = source_url(src, rel)
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
        rows.append((f"ubl-2.1/xsd/{rel}", source, source_licence(src), sha))
    return rows


def fatturapa_official(manifest, fdir):
    fpa = source_by_id(manifest, "fatturapa")
    dsig = source_by_id(manifest, "xmldsig")
    gobl = source_by_id(manifest, "gobl")
    hint = source_hint(fpa)
    rows = []
    ((fpa_name, fpa_sha, _z, _m),) = source_files(fpa)
    dest = fdir / fpa_name
    if cached(dest, fpa_sha):
        print(f"  fatturapa/{fpa_name} [cached]")
    else:
        url = source_url(fpa, fpa_name)
        store(dest, fetch(url, timeout=60), fpa_sha, url, hint)
        print(f"  fatturapa/{fpa_name} [downloaded]")
    rows.append(
        (f"fatturapa/{fpa_name}", source_url(fpa, fpa_name), fpa["licence"], fpa_sha)
    )
    ((dsig_name, dsig_sha, _z, _m),) = source_files(dsig)
    xmldsig = fdir / dsig_name
    dsig_url = source_url(dsig, dsig_name)
    if cached(xmldsig, dsig_sha):
        print(f"  fatturapa/{dsig_name} [cached]")
        rows.append((f"fatturapa/{dsig_name}", dsig_url, source_licence(dsig), dsig_sha))
        return rows
    try:
        store(xmldsig, fetch(dsig_url, timeout=60), dsig_sha, dsig_url, hint)
        source = dsig_url
    except NETWORK_ERRORS as exc:
        print(
            f"  w3.org unreachable ({exc}); fetching identical copy from gobl.fatturapa",
            file=sys.stderr,
        )
        source = source_url(gobl, "xmldsig-core.xsd")
        store(xmldsig, fetch(source, timeout=60), dsig_sha, source, hint)
    print(f"  fatturapa/{dsig_name} [downloaded]")
    rows.append((f"fatturapa/{dsig_name}", source, source_licence(dsig), dsig_sha))
    return rows


def fatturapa_gobl(manifest, fdir):
    gobl = source_by_id(manifest, "gobl")
    hint = source_hint(source_by_id(manifest, "fatturapa"))
    rows = []
    for name, sha, _zip, _member in source_files(gobl):
        dest, url = fdir / name, source_url(gobl, name)
        if cached(dest, sha):
            print(f"  fatturapa/{name} [cached]")
        else:
            store(dest, fetch(url, timeout=60), sha, url, hint)
            print(f"  fatturapa/{name} [downloaded]")
        rows.append((f"fatturapa/{name}", url, source_licence(gobl), sha))
    return rows


def vendor_fatturapa(manifest):
    fdir = VENDOR / "fatturapa"
    gobl = source_by_id(manifest, "gobl")
    try:
        rows = fatturapa_official(manifest, fdir)
        keep = {name for name, *_ in source_files(source_by_id(manifest, "fatturapa"))}
        keep |= {name for name, *_ in source_files(source_by_id(manifest, "xmldsig"))}
    except NETWORK_ERRORS as exc:
        print(
            f"WARNING: fatturapa.gov.it unreachable ({exc}); falling back to "
            f"invopop/gobl.fatturapa (schema version {gobl['version']}, NOT the current "
            f"{source_by_id(manifest, 'fatturapa')['version']})",
            file=sys.stderr,
        )
        rows = fatturapa_gobl(manifest, fdir)
        keep = {name for name, *_ in source_files(gobl)}
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


def zip_groups(src):
    """{rendered zip name: {file name: (member, sha)}} preserving manifest order."""
    groups = {}
    for name, sha, zip_name, member in source_files(src):
        groups.setdefault(zip_name, {})[name] = (member, sha)
    return groups


def vendor_zip_source(src, vdir, prefix, no_local):
    rows = []
    roots = local_roots(src, no_local)
    for zip_name, files in zip_groups(src).items():
        rows += vendor_from_zip(
            vdir,
            prefix,
            files,
            source_url(src, zip_name),
            source_licence(src),
            source_hint(src),
            roots,
            no_local,
        )
    return rows


def vendor_saxon(manifest, no_local):
    src = source_by_id(manifest, "saxon")
    zip_name = next(iter(zip_groups(src)))
    print(
        f"saxon-js: SaxonJS {src['version']} browser runtime ({source_url(src, zip_name)})"
    )
    return vendor_zip_source(src, VENDOR / "saxon-js", "saxon-js/", no_local)


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


def vendor_schematron(manifest, no_local):
    sdir = VENDOR / "schematron"
    cen = source_by_id(manifest, "cen")
    peppol = source_by_id(manifest, "peppol")
    xrechnung = source_by_id(manifest, "xrechnung")
    skeleton = source_by_id(manifest, "skeleton")
    print(
        f"schematron: CEN EN 16931 UBL+CII {cen['version']}, "
        f"{render(peppol['title'], peppol)}, "
        f"XRechnung {xrechnung['vars']['cius']} Schematron {xrechnung['version']}, "
        f"ISO skeleton @{skeleton['version'][:7]}"
    )
    return (
        vendor_zip_source(cen, sdir, "schematron/", no_local)
        + vendor_zip_source(xrechnung, sdir, "schematron/", no_local)
        + vendor_pinned(
            sdir,
            {name: sha for name, sha, _z, _m in source_files(peppol)},
            source_url(peppol, ""),
            source_licence(peppol),
            f" ({peppol['homepage']}/releases)",
        )
        + vendor_pinned(
            sdir,
            {name: sha for name, sha, _z, _m in source_files(skeleton)},
            source_url(skeleton, ""),
            source_licence(skeleton),
            source_hint(skeleton),
        )
    )


def write_sources(manifest, rows):
    fpa = source_by_id(manifest, "fatturapa")
    gobl = source_by_id(manifest, "gobl")
    cen = source_by_id(manifest, "cen")
    peppol = source_by_id(manifest, "peppol")
    xrechnung = source_by_id(manifest, "xrechnung")
    skeleton = source_by_id(manifest, "skeleton")
    saxon = source_by_id(manifest, "saxon")
    ubl_base = source_url(source_by_id(manifest, "ubl"), "")
    fpa_name = source_files(fpa)[0][0]
    cen_tag = render(cen["tag"], cen)
    cen_releases = cen["homepage"]
    peppol_tag = render(peppol["tag"], peppol)
    xrechnung_tag = render(xrechnung["tag"], xrechnung)
    cius = xrechnung["vars"]["cius"]
    saxon_zip = source_url(saxon, render(next(iter(zip_groups(saxon))), saxon))
    ts = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    fetched = ts[:10]
    lines = [
        "# vendor/ provenance",
        "",
        f"Generated {ts} by `tools/fetch_assets.py` (`make schemas`). Do not hand-edit.",
        "Every file is verified against the sha256 pinned in `tools/rulesets.json` on each run;",
        "bump versions with `python3 tools/fetch_assets.py --update <source>=<version>`.",
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
        f"  to {ubl_base} (same sha256 pins).",
        f"- FatturaPA schema page: {fpa['homepage']} - section 'Documentazione valida dal 1 aprile 2025'",
        f"  lists `Schema_VFPA12_V{fpa['version']}.xsd` and `{fpa_name}` (byte-identical, version {fpa['version']},",
        "  technical specifications 1.9); `Schema_VFSM10v_1.0.2.xsd` (semplificata) is not vendored.",
        "- fatturapa.gov.it terms (https://www.fatturapa.gov.it/it/copyright/index.html):",
        f'  "{FPA_TERMS}"',
        "  All rights reserved; storage on one's own computer for personal use is permitted, but",
        "  redistribution is not - so the official AdE example files (e.g.",
        "  https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.2/IT01234567890_FPR01.xml)",
        "  are NOT vendored; a synthetic TD01 example is generated instead. vendor/ itself is",
        "  git-ignored and never redistributed.",
        "- Fallback source when fatturapa.gov.it is unreachable: invopop/gobl.fatturapa (Apache-2.0),",
        f"  which ships schema version {gobl['version']} (missing {fpa['version']} additions such as TD29 and RF20).",
        "",
        "### Schematron rule sets (compiled to SEF by `frontend/scripts/build-sef.mjs`)",
        "",
        f"- CEN/TC 434 EN 16931 UBL validation artefacts **{cen['version']}** (release `{cen_tag}`,",
        f"  {cen_releases}/tag/{cen_tag}). `EN16931-UBL-validation.xslt` is the ready-compiled XSLT 2.0 shipped",
        f"  in `en16931-ubl-{cen['version']}.zip`; the local clone copy is byte-identical (same pin).",
        "  Newer CEN releases may exist; bump deliberately via",
        "  `python3 tools/fetch_assets.py --update cen=<version>`.",
        f"- **{render(peppol['title'], peppol)}**, tag `{peppol_tag}` ({peppol['homepage']}/releases/tag/{peppol_tag}).",
        "  That repository ships Schematron sources only (`rules/sch/`); there is no `rules/xslt/`",
        "  path in any tag, so the `.sch` is compiled to XSLT at SEF build time with the ISO",
        "  skeleton below. `CEN-EN16931-UBL.sch` inside the BIS release carries the same CEN",
        f"  version header ({cen['version']}) as the standalone artefact above (`rules/sch/README.md`",
        "  claims 1.3.14.1 and is stale), but is not identical: the OpenPeppol copy ships a newer",
        "  ISO 6523 ICD / CEF EAS code list (adds 0245). Both are vendored so the two can be",
        "  compared and a Peppol access point's exact pair can be reproduced.",
        f"- CEN/TC 434 EN 16931 CII validation artefacts **{cen['version']}**, same release, from",
        f"  `en16931-cii-{cen['version']}.zip`. `EN16931-CII-validation.xslt` is the ready-compiled XSLT 2.0;",
        "  the local clone copy is byte-identical (same pin).",
        f"- **XRechnung {cius} Schematron {xrechnung['version']}** (KoSIT / xeinkauf.de),",
        f"  release `{xrechnung_tag}` ({xrechnung['homepage']}/tag/{xrechnung_tag}), Apache-2.0.",
        "  The release ships both `.sch` sources and ready-compiled `.xsl`; the `.xsl` is vendored",
        "  because it is the artefact KoSIT itself ships in the validator-configuration bundle.",
        f"  From {xrechnung['version']} on the rules are compiled with **SchXslt**, not the ISO",
        "  skeleton, so the SVRL `@location` uses the `/Q{uri}Name[n]` form rather than",
        "  `/*:Name[namespace-uri()='uri'][n]` - `frontend/src/svrl.ts` normalises both.",
        f"- ISO Schematron 'skeleton' XSLT2 implementation, commit `{skeleton['version']}`",
        f"  ({skeleton['homepage']}, MIT). `iso_svrl_for_xslt2.xsl` imports",
        "  `iso_schematron_skeleton_for_saxon.xsl`, so both must sit in the same directory.",
        "",
        "### SaxonJS browser runtime",
        "",
        f"- **SaxonJS {saxon['version']}** (`SaxonJS2.rt.js`, 499 kB) from {saxon_zip}.",
        "  The npm package `saxon-js` ships the Node build only (`SaxonJS2N.js`, requires `fs`),",
        "  so the browser runtime has to come from Saxonica directly. Keep it in lockstep with the",
        f"  `saxon-js` devDependency ({saxon['version']}.x): SEF is tied to the SaxonJS major version.",
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


# --- --update <source>=<version> ----------------------------------------------------------


def git_dirty(path):
    try:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "status", "--porcelain", "--", str(path)],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return False  # not under git / git unavailable: nothing to compare against
    return bool(result.stdout.strip())


def update_source(spec, manifest_path=MANIFEST, fetcher=fetch):
    """Bump one source: download unpinned, print hash transitions, write pins back."""
    source_id, sep, new_version = spec.partition("=")
    if not sep or not new_version:
        raise RuntimeError(f"--update expects <source>=<version>, got {spec!r}")
    if git_dirty(manifest_path):
        raise RuntimeError(
            f"{manifest_path} has uncommitted changes; commit or stash them before --update"
        )
    data = load_manifest(manifest_path)
    src = source_by_id(data, source_id)
    if "version" not in src:
        raise RuntimeError(f"source {source_id!r} has no version field to update")
    old_version = src["version"]
    src["version"] = new_version
    zips = {}
    changed = 0
    for key, value in src["files"].items():
        name = render(key, src)
        old_sha = value if isinstance(value, str) else value["sha256"]
        if isinstance(value, str):
            payload = fetcher(source_url(src, name), timeout=180)
        else:
            url = source_url(src, render(value["zip"], src))
            if url not in zips:
                zips[url] = fetcher(url, timeout=300)
            with zipfile.ZipFile(io.BytesIO(zips[url])) as zf:
                try:
                    payload = zf.read(value["member"])
                except KeyError:
                    raise RuntimeError(
                        f"{url}: member {value['member']} missing; release layout changed"
                    ) from None
        new_sha = sha256(payload)
        print(f"  {name}  {old_sha} -> {new_sha}")
        if new_sha == old_sha:
            print(
                f"  WARNING: {name} is byte-identical to the {old_version} pin",
                file=sys.stderr,
            )
        else:
            changed += 1
        if isinstance(value, str):
            src["files"][key] = new_sha
        else:
            value["sha256"] = new_sha
    if new_version != old_version and changed == 0:
        raise RuntimeError(
            f"{source_id}: version moved {old_version} -> {new_version} but no file hash "
            "changed - the URL template likely served the old asset; refusing to write "
            f"{manifest_path}"
        )
    src["fetchedAt"] = datetime.now(UTC).strftime("%Y-%m-%d")
    save_manifest(data, manifest_path)
    print(f"{source_id}: {old_version} -> {new_version} pinned in {manifest_path}")
    return data


# --- entry point ---------------------------------------------------------------------------


def vendor_all(manifest, no_local):
    rows = (
        vendor_ubl(manifest, no_local)
        + vendor_fatturapa(manifest)
        + vendor_schematron(manifest, no_local)
        + vendor_saxon(manifest, no_local)
    )
    write_sources(manifest, rows)
    print(f"vendor/: {len(rows)} assets, SOURCES.md written ({VENDOR})")


def main():
    ap = argparse.ArgumentParser(
        description="Vendor UBL 2.1 / FatturaPA XSDs, the EN 16931 / Peppol / XRechnung "
        "Schematron rule sets and the SaxonJS browser runtime into vendor/ (make schemas). "
        "Versions and sha256 pins live in tools/rulesets.json; local standards bundles are "
        "found via STANDARDS_DIRS (os.pathsep-separated, unset = download)."
    )
    ap.add_argument(
        "--no-local",
        action="store_true",
        help="ignore STANDARDS_DIRS bundles and download everything",
    )
    ap.add_argument(
        "--update",
        metavar="SOURCE=VERSION",
        help="bump one source in tools/rulesets.json (downloads unpinned, rewrites the "
        "pins, then re-runs the pinned path so the new pins are enforced immediately)",
    )
    ap.add_argument(
        "--manifest",
        type=Path,
        default=MANIFEST,
        help="alternative rulesets.json (default: tools/rulesets.json)",
    )
    args = ap.parse_args()
    try:
        if args.update:
            manifest = update_source(args.update, manifest_path=args.manifest)
        else:
            manifest = load_manifest(args.manifest)
        vendor_all(manifest, args.no_local)
    except (*NETWORK_ERRORS, RuntimeError, ValueError, KeyError) as exc:
        print(f"ERROR: asset vendoring failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
