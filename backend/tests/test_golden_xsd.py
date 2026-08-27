import re
from pathlib import Path

import pytest

from app.validate import XsdValidator

REPO_ROOT = Path(__file__).resolve().parents[2]
GOLDEN_DIR = REPO_ROOT / "frontend" / "tests" / "golden"
VENDOR_DIR = REPO_ROOT / "vendor"

NO_SCHEMA = {"cii"}

# A non-Italian party cannot satisfy the Italian schema: CAP is five digits, Provincia is two
# upper-case letters. These renderings are kept as negative fixtures, not fixed.
CROSS_FORMAT_INVALID = {
    "be-peppol.fatturapa.xml": "CAP",
    "be-peppol-broken.fatturapa.xml": "CAP",
    "de-hotel-b2b-zugferd.fatturapa.xml": "Provincia",
    "de-hotel-b2g-xrechnung.fatturapa.xml": "Provincia",
    "de-hotel-b2g-broken.fatturapa.xml": "Provincia",
    "fr-store-b2b-facturx.fatturapa.xml": "Provincia",
    "fr-store-b2g-chorus.fatturapa.xml": "Provincia",
}

# One preset per country exists to fail. The marker names the element the deliberate defect breaks,
# so a defect that stops reaching the schema shows up here rather than passing silently.
#   broken             — buyer postal address with no country code, so Sede has no Nazione.
#   fr-store-b2g-broken — no BT-31 anywhere, so IdTrasmittente/IdCodice and the cedente's
#                         mandatory IdFiscaleIVA are both missing. (Its French address would fail
#                         Provincia too, the way its sibling fr-store-b2g-chorus does.)
# be-peppol-broken and de-hotel-b2g-broken carry business-rule defects only — a wrong mod-97 check
# digit and two missing XRechnung fields — so their FatturaPA renderings fail on nothing but the
# cross-format reasons above, and they stay in CROSS_FORMAT_INVALID.
DELIBERATELY_BROKEN = {
    "broken.fatturapa.xml": "Nazione",
    "fr-store-b2g-broken.fatturapa.xml": "IdCodice",
}

EXPECTED_INVALID = {**CROSS_FORMAT_INVALID, **DELIBERATELY_BROKEN}

pytestmark = pytest.mark.skipif(
    not VENDOR_DIR.exists() or not GOLDEN_DIR.exists(),
    reason="vendor/ missing — run make schemas",
)


def goldens():
    return sorted(GOLDEN_DIR.glob("*.xml"))


def schema_key_for(path: Path):
    fmt = path.name.split(".")[-2]
    if fmt in NO_SCHEMA:
        return None
    if fmt == "fatturapa":
        return "fatturapa-1.2"
    body = path.read_bytes()[:400].decode("utf-8", "replace")
    root = re.search(r"<(?:\w+:)?(\w+)[\s>]", body.split("?>", 1)[-1])
    return "ubl-creditnote-2.1" if root and root.group(1) == "CreditNote" else "ubl-invoice-2.1"


@pytest.fixture(scope="module")
def validator():
    return XsdValidator(VENDOR_DIR)


@pytest.mark.parametrize("path", goldens(), ids=lambda p: p.name)
def test_golden_matches_expected_schema_validity(validator, path):
    schema_key = schema_key_for(path)
    if schema_key is None:
        pytest.skip(f"no XSD vendored for {path.name.split('.')[-2]}")
    result = validator.validate(schema_key, path.read_bytes())
    marker = EXPECTED_INVALID.get(path.name)
    if marker is None:
        assert result["valid"], f"{path.name} should be schema-valid: {result['findings'][:2]}"
        return
    assert not result["valid"], f"{path.name} unexpectedly valid; drop it from EXPECTED_INVALID"
    assert any(marker in f["message"] for f in result["findings"]), result["findings"]


def test_expected_invalid_entries_all_exist():
    on_disk = {p.name for p in goldens()}
    missing = sorted(set(EXPECTED_INVALID) - on_disk)
    assert not missing, f"EXPECTED_INVALID names goldens that no longer exist: {missing}"


def test_native_rendering_of_every_preset_is_schema_valid(validator):
    native = [p for p in goldens() if p.name not in EXPECTED_INVALID and schema_key_for(p)]
    assert native, "no goldens found"
    bad = [
        p.name for p in native if not validator.validate(schema_key_for(p), p.read_bytes())["valid"]
    ]
    assert not bad, f"schema-invalid goldens: {bad}"
