"""tools/rulesets.json + tools/fetch_assets.py: manifest round-trip, URL templating and
the --update refusals. tools/ is importable via the sys.path insert in conftest.py."""

import json

import fetch_assets as fa
import pytest

# en16931-ubl and xrechnung-cii were dropped 2026-09-03: no format plugin resolved them
# (empty `formats`), so they were ~8.5 MB of shipped SEF that nothing could ever load.
RULE_SET_IDS = {
    "en16931-cii",
    "peppol-ubl",
    "cen-ubl",
    "xrechnung-ubl",
}


def mini_manifest(tmp_path, sha):
    path = tmp_path / "rulesets.json"
    fa.save_manifest(
        {
            "sources": [
                {
                    "id": "demo",
                    "version": "1.0.0",
                    "licence": "MIT",
                    "distribution": "raw",
                    "urlTemplate": "https://example.test/{version}/{file}",
                    "homepage": "https://example.test",
                    "files": {"rules-{version}.sch": sha},
                    "fetchedAt": "2026-01-01",
                }
            ],
            "ruleSets": [],
        },
        path,
    )
    return path


def test_manifest_round_trips_and_is_complete(tmp_path):
    data = fa.load_manifest()
    copy = tmp_path / "rulesets.json"
    fa.save_manifest(data, copy)
    assert json.loads(copy.read_text()) == data

    ids = {src["id"] for src in data["sources"]}
    assert {"ubl", "fatturapa", "cen", "peppol", "xrechnung", "skeleton", "saxon"} <= ids
    assert {rs["id"] for rs in data["ruleSets"]} == RULE_SET_IDS
    for rs in data["ruleSets"]:
        src = fa.source_by_id(data, rs["source"])
        names = {name for name, *_ in fa.source_files(src)}
        assert rs["file"] in names, f"{rs['id']}: {rs['file']} not vendored by {rs['source']}"
        assert rs["compile"] in ("sch", "none")
    for src in data["sources"]:
        for name, sha, zip_name, member in fa.source_files(src):
            assert len(sha) == 64, f"{src['id']}/{name}: not a sha256 pin"
            assert (zip_name is None) == (member is None)
        assert "{version}" not in fa.source_licence(src)


def test_url_templating_renders_version_and_file():
    data = fa.load_manifest()
    cen = fa.source_by_id(data, "cen")
    v = cen["version"]
    assert fa.source_url(cen, f"en16931-ubl-{v}.zip") == (
        "https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/"
        f"validation-{v}/en16931-ubl-{v}.zip"
    )
    name, _sha, zip_name, member = fa.source_files(cen)[0]
    assert (name, zip_name, member) == (
        "EN16931-UBL-validation.xslt",
        f"en16931-ubl-{v}.zip",
        "xslt/EN16931-UBL-validation.xslt",
    )
    peppol = fa.source_by_id(data, "peppol")
    assert fa.source_url(peppol, "PEPPOL-EN16931-UBL.sch") == (
        "https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/"
        f"v{peppol['version']}/rules/sch/PEPPOL-EN16931-UBL.sch"
    )
    skeleton = fa.source_by_id(data, "skeleton")
    assert f"/{skeleton['version']}/" in fa.source_url(skeleton, "iso_svrl_for_xslt2.xsl")
    fpa = fa.source_by_id(data, "fatturapa")
    ((name, *_),) = fa.source_files(fpa)
    assert name == f"Schema_VFPR12_v{fpa['version']}.xsd"
    with pytest.raises(RuntimeError, match="unknown source"):
        fa.source_by_id(data, "nope")


def test_update_refuses_dirty_manifest(tmp_path, monkeypatch):
    path = mini_manifest(tmp_path, fa.sha256(b"old"))
    monkeypatch.setattr(fa, "git_dirty", lambda _p: True)
    with pytest.raises(RuntimeError, match="uncommitted changes"):
        fa.update_source("demo=2.0.0", manifest_path=path, fetcher=lambda *a, **k: b"new")
    assert fa.load_manifest(path)["sources"][0]["version"] == "1.0.0"


def test_update_refuses_unchanged_hash(tmp_path, monkeypatch):
    payload = b"same bytes at every version"
    path = mini_manifest(tmp_path, fa.sha256(payload))
    monkeypatch.setattr(fa, "git_dirty", lambda _p: False)
    with pytest.raises(RuntimeError, match="no file hash"):
        fa.update_source("demo=2.0.0", manifest_path=path, fetcher=lambda *a, **k: payload)
    stale = fa.load_manifest(path)["sources"][0]
    assert stale["version"] == "1.0.0", "refusal must leave the manifest untouched"
    assert stale["fetchedAt"] == "2026-01-01"


def test_update_rewrites_pins_and_renders_new_urls(tmp_path, monkeypatch, capsys):
    old_sha = fa.sha256(b"old")
    path = mini_manifest(tmp_path, old_sha)
    monkeypatch.setattr(fa, "git_dirty", lambda _p: False)
    seen = []

    def fake_fetch(url, timeout=0):
        seen.append(url)
        return b"new"

    data = fa.update_source("demo=2.0.0", manifest_path=path, fetcher=fake_fetch)
    assert seen == ["https://example.test/2.0.0/rules-2.0.0.sch"]
    src = data["sources"][0]
    assert src["version"] == "2.0.0"
    assert src["files"]["rules-{version}.sch"] == fa.sha256(b"new")
    assert src["fetchedAt"] != "2026-01-01"
    assert json.loads(path.read_text()) == data
    out = capsys.readouterr().out
    assert f"{old_sha} -> {fa.sha256(b'new')}" in out


def test_update_rejects_malformed_spec_and_versionless_source(tmp_path, monkeypatch):
    monkeypatch.setattr(fa, "git_dirty", lambda _p: False)
    path = mini_manifest(tmp_path, fa.sha256(b"x"))
    with pytest.raises(RuntimeError, match="expects <source>=<version>"):
        fa.update_source("demo", manifest_path=path)
    data = fa.load_manifest(path)
    del data["sources"][0]["version"]
    data["sources"][0]["files"] = {"rules.sch": fa.sha256(b"x")}
    fa.save_manifest(data, path)
    with pytest.raises(RuntimeError, match="no version field"):
        fa.update_source("demo=2.0.0", manifest_path=path)
