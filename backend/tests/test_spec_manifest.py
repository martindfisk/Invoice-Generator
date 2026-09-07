import hashlib
import json

import fetch_spec
import pytest
import spec_check

from app.settings import COUNTRIES
from app.spec import active_spec, load_schemas, manifest
from tests.conftest import make_settings

SPEC = make_settings().spec_dir

pytestmark = pytest.mark.skipif(not SPEC.exists(), reason="spec/ missing — run make spec")

OPENAPI_HEAD = """openapi: 3.0.3
info:
  title: {title}
  version: '{version}'
paths: {{}}
"""


def test_the_manifest_matches_the_bytes_on_disk():
    recorded = manifest(SPEC)
    assert recorded, "spec/spec.json missing — run make spec"
    entries = list(recorded["fallback"]) + list(recorded["collections"])
    if recorded.get("spec"):
        entries.append(recorded["spec"])
    assert entries
    for entry in entries:
        path = SPEC / entry["file"]
        assert path.exists(), entry["file"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"], entry["file"]


def test_version_txt_agrees_with_the_manifest():
    recorded = manifest(SPEC)
    assert (SPEC / "version.txt").read_text().strip() == recorded["apiVersion"]


def test_every_vendored_spec_is_listed():
    recorded = manifest(SPEC)
    known = {entry["file"] for entry in recorded["fallback"]}
    known |= {entry["file"] for entry in recorded["collections"]}
    if recorded.get("spec"):
        known.add(recorded["spec"]["file"])
    strays = sorted(path.name for path in SPEC.glob("*.y*ml") if path.name not in known)
    assert strays == [], f"unlisted specs in spec/: {strays}"


def test_the_drop_folder_is_empty_once_ingested():
    assert sorted(path.name for path in (SPEC / "drop").glob("*.y*ml")) == []


def test_spec_check_passes_on_the_committed_tree():
    assert spec_check.check(include_types=False) == []


def test_every_supported_country_resolves_to_a_readable_spec():
    for country in COUNTRIES:
        assert active_spec(SPEC, country).exists()
        schemas, digest, name = load_schemas(SPEC, country)
        assert "InvoiceTransaction" in schemas
        assert len(digest) == 64
        assert name.endswith(".yaml")


def test_read_info_pulls_the_version_and_title_out_of_the_document():
    text = OPENAPI_HEAD.format(title="fiskaly Unified API (all countries)", version="2026-06-01")
    assert fetch_spec.read_info(text, "test") == (
        "2026-06-01",
        "fiskaly Unified API (all countries)",
    )
    with pytest.raises(ValueError, match="not an OpenAPI 3 document"):
        fetch_spec.read_info("swagger: '2.0'\n", "test")
    with pytest.raises(ValueError, match="no CalVer info.version"):
        fetch_spec.read_info(
            "openapi: 3.0.3\ninfo:\n  title: x\n  version: '1.0'\npaths: {}\n", "t"
        )


def _drop(monkeypatch, tmp_path):
    spec_dir = tmp_path / "spec"
    drop = spec_dir / "drop"
    drop.mkdir(parents=True)
    monkeypatch.setattr(fetch_spec, "SPEC_DIR", spec_dir)
    monkeypatch.setattr(fetch_spec, "DROP_DIR", drop)
    return spec_dir, drop


def test_ingesting_a_dropped_spec_identifies_it_by_content(monkeypatch, tmp_path):
    spec_dir, drop = _drop(monkeypatch, tmp_path)
    # A deliberately misleading filename: the version must come from info.version, not the name.
    (drop / "whatever-i-downloaded.yaml").write_text(
        OPENAPI_HEAD.format(title="fiskaly Unified API (all countries)", version="2027-01-01")
    )
    entry = fetch_spec.ingest_drop()
    assert entry["file"] == "fiskaly.unified-api.all.2027-01-01.yaml"
    assert entry["version"] == "2027-01-01"
    assert entry["origin"] == "drop:whatever-i-downloaded.yaml"
    assert (spec_dir / entry["file"]).exists()
    # The move is the "consumed" signal the doctor check reads.
    assert list(drop.glob("*.yaml")) == []
    assert fetch_spec.ingest_drop() is None


def test_ingesting_refuses_more_than_one_dropped_spec(monkeypatch, tmp_path):
    _, drop = _drop(monkeypatch, tmp_path)
    for name in ("one.yaml", "two.yaml"):
        (drop / name).write_text(
            OPENAPI_HEAD.format(title="fiskaly Unified API", version="2026-06-01")
        )
    with pytest.raises(RuntimeError, match="keep exactly one"):
        fetch_spec.ingest_drop()
    assert len(list(drop.glob("*.yaml"))) == 2


def test_ingesting_refuses_a_per_country_spec(monkeypatch, tmp_path):
    _, drop = _drop(monkeypatch, tmp_path)
    (drop / "it.yaml").write_text(
        OPENAPI_HEAD.format(title="fiskaly E-INVOICE IT", version="2026-06-01")
    )
    with pytest.raises(RuntimeError, match="all-products Unified API spec"):
        fetch_spec.ingest_drop()


def test_carrying_forward_refuses_a_spec_edited_after_ingestion(monkeypatch, tmp_path):
    spec_dir, _ = _drop(monkeypatch, tmp_path)
    body = OPENAPI_HEAD.format(title="fiskaly Unified API", version="2026-06-01")
    (spec_dir / "fiskaly.unified-api.all.2026-06-01.yaml").write_text(body)
    previous = {
        "spec": {
            "file": "fiskaly.unified-api.all.2026-06-01.yaml",
            "sha256": hashlib.sha256(body.encode()).hexdigest(),
        }
    }
    assert fetch_spec.carry_forward_spec(previous)["file"].endswith(".yaml")
    (spec_dir / "fiskaly.unified-api.all.2026-06-01.yaml").write_text(body + "# edited\n")
    with pytest.raises(RuntimeError, match="changed on disk"):
        fetch_spec.carry_forward_spec(previous)


def test_spec_check_reports_a_pending_drop_and_a_tampered_file(monkeypatch, tmp_path):
    spec_dir = tmp_path / "spec"
    drop = spec_dir / "drop"
    drop.mkdir(parents=True)
    body = OPENAPI_HEAD.format(title="fiskaly Unified API", version="2026-06-01")
    (spec_dir / "fiskaly.unified-api.all.2026-06-01.yaml").write_text(body)
    (spec_dir / "version.txt").write_text("2026-06-01\n")
    (spec_dir / "spec.json").write_text(
        json.dumps(
            {
                "apiVersion": "2026-06-01",
                "spec": {
                    "file": "fiskaly.unified-api.all.2026-06-01.yaml",
                    "sha256": hashlib.sha256(body.encode()).hexdigest(),
                },
                "fallback": [],
                "collections": [],
            }
        )
    )
    monkeypatch.setattr(spec_check, "SPEC_DIR", spec_dir)
    monkeypatch.setattr(spec_check, "DROP_DIR", drop)
    monkeypatch.setattr(spec_check, "MANIFEST", spec_dir / "spec.json")
    assert spec_check.check(include_types=False) == []

    (drop / "pending.yaml").write_text(body)
    assert any("not ingested yet" in error for error in spec_check.check(include_types=False))
    (drop / "pending.yaml").unlink()

    (spec_dir / "fiskaly.unified-api.all.2026-06-01.yaml").write_text(body + "# tampered\n")
    errors = spec_check.check(include_types=False)
    assert any("changed after ingestion" in error for error in errors)


def test_a_run_that_changes_nothing_keeps_the_previous_timestamp():
    # generatedAt is the only field that moves on every run, so without this `make spec` would
    # dirty spec.json and SOURCES.md every time and hide a real change in the noise.
    previous = {
        "generatedAt": "2026-09-02T16:42:00Z",
        "apiVersion": "2026-06-01",
        "spec": {"file": "a.yaml", "sha256": "x"},
        "fallback": [],
        "collections": [],
    }
    unchanged = {**previous, "generatedAt": "2026-09-02T16:51:37Z"}
    assert fetch_spec._same(previous, unchanged)

    moved = {**unchanged, "spec": {"file": "a.yaml", "sha256": "y"}}
    assert not fetch_spec._same(previous, moved)
    assert not fetch_spec._same(previous, {**unchanged, "apiVersion": "2027-03-01"})


def test_verify_frozen_flags_missing_and_tampered_entries(tmp_path, monkeypatch):
    monkeypatch.setattr(fetch_spec, "SPEC_DIR", tmp_path)
    good = tmp_path / "kept.json"
    good.write_bytes(b'{"ok": true}')
    changed = tmp_path / "changed.json"
    changed.write_bytes(b'{"ok": false}')
    entries = [
        {"file": "kept.json", "sha256": hashlib.sha256(b'{"ok": true}').hexdigest()},
        {"file": "changed.json", "sha256": hashlib.sha256(b"what was ingested").hexdigest()},
        {"file": "gone.json", "sha256": "irrelevant"},
    ]
    absent, tampered = fetch_spec.verify_frozen(entries)
    assert absent == ["gone.json"]
    assert tampered == ["changed.json"]
