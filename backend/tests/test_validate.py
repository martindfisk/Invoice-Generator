from pathlib import Path

import pytest

from app.validate import XsdValidator
from tests.conftest import api_for, make_settings

FIXTURES = Path(__file__).parent / "fixtures"
CEN = FIXTURES / "cen-en16931"
SYNTHETIC = FIXTURES / "synthetic"
VENDOR = make_settings().vendor_dir

pytestmark = pytest.mark.skipif(not VENDOR.exists(), reason="vendor/ missing — run make schemas")

VALID_SAMPLES = [
    ("ubl-invoice-2.1", CEN / "ubl-tc434-example1.xml"),
    ("ubl-creditnote-2.1", CEN / "ubl-tc434-creditnote1.xml"),
    ("fatturapa-1.2", SYNTHETIC / "fatturapa-td01.xml"),
]
BROKEN_SAMPLES = [
    ("ubl-invoice-2.1", SYNTHETIC / "ubl-invoice-broken.xml", "IssueDate"),
    ("ubl-creditnote-2.1", SYNTHETIC / "ubl-creditnote-broken.xml", "IssueDate"),
    ("fatturapa-1.2", SYNTHETIC / "fatturapa-td01-broken.xml", "ProgressivoInvio"),
]


@pytest.fixture(scope="module")
def validator():
    return XsdValidator(VENDOR)


@pytest.mark.parametrize(("schema_key", "sample"), VALID_SAMPLES)
def test_valid_sample_passes(validator, schema_key, sample):
    assert validator.validate(schema_key, sample.read_bytes()) == {"valid": True, "findings": []}


@pytest.mark.parametrize(("schema_key", "sample", "culprit"), BROKEN_SAMPLES)
def test_broken_sample_yields_located_finding(validator, schema_key, sample, culprit):
    result = validator.validate(schema_key, sample.read_bytes())
    assert result["valid"] is False
    finding = result["findings"][0]
    assert finding["line"] > 0
    assert culprit in finding["message"]
    assert finding["path"]


def test_malformed_xml_reports_null_path(validator):
    result = validator.validate("ubl-invoice-2.1", b"<Invoice><ID></Invoice>")
    assert result["valid"] is False
    finding = result["findings"][0]
    assert finding["line"] == 1
    assert finding["column"] > 0
    assert finding["path"] is None


def test_unknown_schema_key_raises(validator):
    with pytest.raises(KeyError):
        validator.validate("cii-d16b", b"<x/>")


def test_missing_vendor_dir_points_to_make_schemas(tmp_path):
    with pytest.raises(FileNotFoundError, match="run: make schemas"):
        XsdValidator(tmp_path / "vendor").validate("ubl-invoice-2.1", b"<x/>")


def test_vendored_fatturapa_examples_validate(validator):
    examples = sorted((VENDOR / "fatturapa" / "examples").glob("*.xml"))
    assert examples
    for example in examples:
        result = validator.validate("fatturapa-1.2", example.read_bytes())
        assert result == {"valid": True, "findings": []}, example.name


async def test_validate_xsd_route(api):
    _, client = api
    body = {"schema": "fatturapa-1.2", "xml": (SYNTHETIC / "fatturapa-td01.xml").read_text()}
    response = await client.post("/api/validate/xsd", json=body)
    assert response.status_code == 200
    assert response.json() == {"valid": True, "findings": []}
    body = {"schema": "ubl-invoice-2.1", "xml": (SYNTHETIC / "ubl-invoice-broken.xml").read_text()}
    response = await client.post("/api/validate/xsd", json=body)
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is False
    assert result["findings"][0]["line"] > 0


async def test_validate_xsd_route_rejects_unknown_schema(api):
    _, client = api
    response = await client.post("/api/validate/xsd", json={"schema": "cii-d16b", "xml": "<x/>"})
    assert response.status_code == 400
    assert "cii-d16b" in response.json()["detail"]


async def test_validate_xsd_route_without_vendor_dir(tmp_path):
    async with api_for(make_settings(vendor_dir=tmp_path / "vendor")) as (_, client):
        response = await client.post(
            "/api/validate/xsd", json={"schema": "fatturapa-1.2", "xml": "<x/>"}
        )
        assert response.status_code == 503
        assert "run: make schemas" in response.json()["detail"]
