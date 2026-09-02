import copy
import json
from pathlib import Path

import pytest

from app.settings import COUNTRIES
from app.spec import active_spec, load_schemas
from app.validate import UapiSchemaValidator
from tests.conftest import api_for, make_settings

SPEC = make_settings().spec_dir
GOLDEN = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "golden"
REFERENCE = Path(__file__).resolve().parents[2] / "docs" / "reference" / "fatturapa"

pytestmark = pytest.mark.skipif(not SPEC.exists(), reason="spec/ missing — run make spec")


@pytest.fixture(scope="module")
def validator():
    return UapiSchemaValidator(SPEC)


def golden(name):
    return json.loads((GOLDEN / f"{name}.uapi.json").read_text())


def pointers(result):
    return [(item["pointer"], item["keyword"]) for item in result["findings"]]


def test_a_preset_operation_satisfies_the_contract(validator):
    assert validator.validate(golden("be-peppol"), "BE") == {"valid": True, "findings": []}


def test_the_operation_fiskaly_accepted_validates_clean_for_italy(validator):
    # docs/reference/fatturapa/tested-payload.json is a real request the fiskaly gateway
    # accepted and rendered into FatturaPA XML (captured 2026-08-25) — the strongest evidence
    # that this contract stage matches reality. It also carries fields we never emit
    # (buyer_routing, shipping, tax_representative, value.discount/surcharge) which the schema
    # must keep accepting. If this validator ever rejects a payload fiskaly demonstrably
    # accepted, the bug is ours.
    body = json.loads((REFERENCE / "tested-payload.json").read_text())
    operation = body["content"]["operation"]
    assert validator.validate(operation, "IT") == {"valid": True, "findings": []}


def test_every_golden_operation_resolves_for_every_supported_country(validator):
    for path in sorted(GOLDEN.glob("*.uapi.json")):
        operation = json.loads(path.read_text())
        for country in COUNTRIES:
            result = validator.validate(operation, country)
            assert isinstance(result["valid"], bool), path.name
            for finding in result["findings"]:
                assert finding["pointer"].startswith("/") or finding["pointer"] == ""
                assert finding["keyword"]
                assert finding["message"]


def test_missing_required_property_reports_the_owning_object(validator):
    operation = golden("be-peppol")
    del operation["totals"]
    assert pointers(validator.validate(operation, "BE")) == [("", "required")]


def test_nested_required_property_carries_its_pointer(validator):
    operation = golden("be-peppol")
    del operation["entries"][0]["data"]["unit"]["price"]["exclusive"]
    assert pointers(validator.validate(operation, "BE")) == [
        ("/entries/0/data/unit/price", "required")
    ]


def test_wrong_enum_value_is_located_at_the_value(validator):
    operation = golden("be-peppol")
    operation["entries"][0]["data"]["vat"]["code"] = "SUPER_REDUCED"
    findings = validator.validate(operation, "BE")["findings"]
    assert pointers({"findings": findings}) == [("/entries/0/data/vat/code", "enum")]
    assert "STANDARD" in findings[0]["message"]


def test_bad_pattern_reports_pattern_and_length_separately(validator):
    operation = golden("be-peppol")
    operation["recipients"][0]["invoicing"] = {"type": "SDI", "destination_code": "abc"}
    assert pointers(validator.validate(operation, "BE")) == [
        ("/recipients/0/invoicing/destination_code", "minLength"),
        ("/recipients/0/invoicing/destination_code", "pattern"),
    ]


def test_the_stale_v4_scalar_unit_price_is_rejected(validator):
    operation = golden("be-peppol")
    operation["entries"][0]["data"]["unit"]["price"] = "12.00"
    assert pointers(validator.validate(operation, "BE")) == [("/entries/0/data/unit/price", "type")]


def test_unknown_property_is_rejected_where_it_was_added(validator):
    operation = golden("be-peppol")
    operation["entries"][0]["surprise"] = True
    assert pointers(validator.validate(operation, "BE")) == [("/entries/0", "additionalProperties")]


def test_every_error_is_reported_not_just_the_first(validator):
    operation = golden("be-peppol")
    operation["document"]["number"] = ""
    operation["entries"][0]["data"]["vat"]["code"] = "NOPE"
    operation["recipients"][0]["address"]["country"] = "XX"
    del operation["payments"][0]["details"]["amount"]
    assert pointers(validator.validate(operation, "BE")) == [
        ("/document/number", "minLength"),
        ("/document/number", "pattern"),
        ("/entries/0/data/vat/code", "enum"),
        ("/payments/0/details", "required"),
        ("/recipients/0/address/country", "enum"),
    ]


def test_openapi_format_is_asserted_for_the_two_formats_the_graph_uses(validator):
    operation = golden("be-peppol")
    operation["document"]["issued_at"] = "not a timestamp at all!!!"
    operation["seller"] = {"email": "nope"}
    assert pointers(validator.validate(operation, "BE")) == [
        ("/document/issued_at", "format"),
        ("/seller/email", "format"),
    ]


def test_discriminator_selects_the_branch_instead_of_burying_it_in_oneof(validator):
    operation = golden("be-peppol")
    operation["payments"][0]["instruction"] = {"type": "CREDIT_TRANSFER", "account": "nope"}
    findings = validator.validate(operation, "BE")["findings"]
    assert ("/payments/0/instruction", "required") in pointers({"findings": findings})
    assert ("/payments/0/instruction/account", "pattern") in pointers({"findings": findings})
    assert all("is not valid under any of the given schemas" not in f["message"] for f in findings)


def test_an_unknown_operation_type_is_a_finding_at_type(validator):
    operation = golden("be-peppol")
    operation["type"] = "RECEIPT"
    assert pointers(validator.validate(operation, "BE")) == [("/type", "enum")]


def test_a_correction_wrapper_validates_its_own_fields_and_the_nested_invoice(validator):
    operation = {
        "type": "CORRECTION",
        "record": {"id": "not-a-uuid"},
        "reason": "two covers were never served",
        "data": golden("be-peppol"),
    }
    assert pointers(validator.validate(operation, "BE")) == [("/record/id", "pattern")]

    operation["record"]["id"] = "0189f7ea-ae2c-7809-8aeb-b819cf5e9e7f"
    operation["data"]["entries"][0]["details"]["concept"] = "MEAL"
    assert pointers(validator.validate(operation, "BE")) == [
        ("/data/entries/0/details/concept", "enum")
    ]


def test_the_compiled_schema_is_cached_by_spec_content(validator):
    # Keyed on the spec's bytes, not on the country. Every country an all-products spec covers
    # shares one compiled graph; under the per-country fallback each spec compiles separately.
    first = validator.schema("IT")
    assert validator.schema("IT") is first
    assert "InvoiceTransaction" in first["$defs"]
    assert "CorrectionTransaction" in first["$defs"]
    _, it_digest, _ = load_schemas(SPEC, "IT")
    _, be_digest, _ = load_schemas(SPEC, "BE")
    if it_digest == be_digest:
        assert validator.schema("BE") is first
    else:
        assert validator.schema("BE") is not first


def test_every_supported_country_resolves_a_spec():
    # SPEC_COUNTRIES used to omit DE, so German payloads were silently checked against the
    # Italian spec. Every country in settings.COUNTRIES must resolve to a real file.
    for country in COUNTRIES:
        assert active_spec(SPEC, country).exists()


def test_compiling_does_not_mutate_the_cached_raw_schemas(validator):
    schemas, _, _ = load_schemas(SPEC, "IT")
    before = copy.deepcopy(schemas["InvoiceTransaction"])
    validator.compile("IT")
    assert load_schemas(SPEC, "IT")[0]["InvoiceTransaction"] == before
    # `example` is stripped for validation but must survive in the raw schemas, which is where
    # the field-metadata extractor reads it from.
    assert "example" in schemas["SdiDestinationCode"]


def test_the_conversion_strips_openapi_only_keywords(validator):
    schema = validator.schema("IT")
    found = set()

    def walk(node):
        if isinstance(node, dict):
            found.update(node.keys() & {"discriminator", "example", "nullable"})
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
    assert found == set()


def test_nullable_widens_the_declared_type():
    from app.validate import _convert

    assert _convert({"type": "string", "nullable": True})["type"] == ["string", "null"]
    assert _convert({"type": ["string", "integer"], "nullable": True})["type"] == [
        "string",
        "integer",
        "null",
    ]
    assert "nullable" not in _convert({"type": "string", "nullable": False})


def test_a_single_branch_oneof_becomes_an_allof():
    from app.validate import _convert

    converted = _convert({"oneOf": [{"$ref": "#/components/schemas/CountryCode2"}]})
    assert converted == {"allOf": [{"$ref": "#/$defs/CountryCode2"}]}


def test_missing_spec_dir_points_to_make_spec(tmp_path):
    with pytest.raises(FileNotFoundError, match="run: make spec"):
        UapiSchemaValidator(tmp_path / "spec").validate({"type": "INVOICE"}, "IT")


async def test_validate_uapi_route(api):
    _, client = api
    response = await client.post(
        "/api/validate/uapi", json={"operation": golden("be-peppol"), "country": "BE"}
    )
    assert response.status_code == 200
    assert response.json() == {"valid": True, "country": "BE", "findings": []}


async def test_validate_uapi_route_reports_pointers(api):
    _, client = api
    operation = golden("be-peppol")
    del operation["entries"][0]["data"]["text"]
    response = await client.post("/api/validate/uapi", json={"operation": operation})
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["country"] == "IT"
    assert body["findings"][0]["pointer"] == "/entries/0/data"
    assert body["findings"][0]["keyword"] == "required"


async def test_validate_uapi_route_defaults_to_italy(api):
    _, client = api
    response = await client.post("/api/validate/uapi", json={"operation": golden("be-peppol")})
    assert response.json()["country"] == "IT"


async def test_validate_uapi_route_rejects_an_unknown_country(api):
    _, client = api
    response = await client.post(
        "/api/validate/uapi", json={"operation": golden("be-peppol"), "country": "FR"}
    )
    assert response.status_code == 400
    assert "FR" in response.json()["detail"]


async def test_validate_uapi_route_without_spec_dir(tmp_path):
    async with api_for(make_settings(spec_dir=tmp_path / "spec")) as (_, client):
        response = await client.post(
            "/api/validate/uapi", json={"operation": {"type": "INVOICE"}, "country": "IT"}
        )
        assert response.status_code == 503
        assert "run: make spec" in response.json()["detail"]


def test_the_golden_operations_expose_the_defects_the_other_stages_miss(validator):
    # The seller phones were E.164-corrected once this stage caught them; they must stay clean.
    for preset_id in ("it-b2b-sdi", "it-restaurant-b2b-fattura", "it-restaurant-td04-credit"):
        assert not any(
            pointer == "/seller/phone"
            for pointer, _ in pointers(validator.validate(golden(preset_id), "IT"))
        ), preset_id

    # Not our defect: fiskaly's SdiDestinationCode is 7 chars exactly, but FatturaPA
    # CodiceDestinatarioType is [A-Z0-9]{6,7} and a public administration uses the
    # 6-character Codice Univoco Ufficio. See references/open-questions.md #8.
    public_authority = validator.validate(golden("it-restaurant-b2g-fpa12"), "IT")
    assert ("/recipients/0/invoicing/destination_code", "minLength") in pointers(public_authority)

    broken = validator.validate(golden("broken"), "IT")
    assert ("/recipients/0/address/country", "enum") in pointers(broken)


def test_the_validator_does_not_mutate_the_operation_it_is_given(validator):
    operation = golden("be-peppol")
    before = copy.deepcopy(operation)
    validator.validate(operation, "BE")
    assert operation == before
