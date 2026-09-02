import pytest

from app.fields import (
    CONSTRAINT_KEYWORDS,
    PLACEHOLDER_SCHEMAS,
    PROFILES,
    STRUCTURAL_KEYWORDS,
    _compact,
    extract,
    field_metadata,
)
from app.settings import COUNTRIES
from app.spec import load_schemas
from app.validate import OPERATION_SCHEMAS
from tests.conftest import make_settings

SPEC = make_settings().spec_dir

pytestmark = pytest.mark.skipif(not SPEC.exists(), reason="spec/ missing — run make spec")

# Placeholder `example` strings the spec puts on its generic base types. None may reach a caller:
# inserting 'text example...' or the invalid E.164 number below would be worse than inserting
# nothing, which is why PLACEHOLDER_SCHEMAS suppresses the value but keeps example_source.
PLACEHOLDER_LITERALS = (
    "text example",
    "0a1B2cD",
    "123456789012.34567890",
    "+11 222 3333333",
    "2006-01-02",
)


@pytest.fixture(scope="module")
def schemas():
    return load_schemas(SPEC, "IT")[0]


@pytest.fixture(scope="module")
def invoice(schemas):
    return extract(schemas, "INVOICE")


def by_pointer(rows, pointer):
    return [row for row in rows if row["pointer"] == pointer]


def test_the_invoice_closure_expands_to_the_expected_surface(invoice):
    rows, unions = invoice
    kinds = {
        kind: sum(1 for row in rows if row["kind"] == kind) for kind in ("leaf", "group", "map")
    }
    # Pinned so a spec bump that changes the payload surface is a red build, not a silent shift.
    assert kinds == {"leaf": 242, "group": 95, "map": 3}
    assert len(unions) == 14
    assert {union["pointer"] for union in unions} >= {
        "/entries/{i}",
        "/entries/{i}/data",
        "/payments/{i}",
        "/recipients/{i}",
        "/recipients/{i}/invoicing",
    }


def test_compaction_reaches_a_fixpoint(invoice):
    rows, _ = invoice
    assert _compact(list(rows)) == rows


def test_a_shared_schema_expands_at_every_pointer_it_appears_at(invoice):
    # Address hangs off three pointers. A `seen`-set cycle guard would terminate the second and
    # third as leaves; the closure is acyclic, so the walker must not carry one.
    rows, _ = invoice
    for pointer in (
        "/recipients/{i}/address/line/street",
        "/recipients/{i}/shipping/address/line/street",
    ):
        assert by_pointer(rows, pointer), pointer
    shipped = by_pointer(rows, "/recipients/{i}/shipping/address/line/street")[0]
    assert shipped["required"] is True
    assert shipped["optional_ancestor"] == "/recipients/{i}/shipping"


def test_a_branch_only_field_is_scoped_to_its_branches(invoice):
    rows, _ = invoice
    variants = {
        tuple(row["variants"]["/payments/{i}"]): row["required"]
        for row in by_pointer(rows, "/payments/{i}/name")
    }
    assert variants == {("ONLINE",): True, ("OTHER",): False}
    for row in by_pointer(rows, "/payments/{i}/concept"):
        assert row["variants"]["/payments/{i}"] == ["OUTSTANDING"]


def test_required_ness_is_conditional_on_the_parent_being_present(invoice):
    rows, _ = invoice
    representative = by_pointer(rows, "/tax_representative/name")[0]
    assert representative["required"] is True
    assert representative["optional_ancestor"] == "/tax_representative"
    total = by_pointer(rows, "/totals/vat/amount")[0]
    assert total["required"] is True
    assert total["optional_ancestor"] is None
    unconditional = [
        row
        for row in rows
        if row["kind"] == "leaf" and row["required"] and row["optional_ancestor"] is None
    ]
    assert len(unconditional) == 80


def test_a_description_wrapper_keeps_the_prose_and_the_targets_constraints(invoice):
    # 205 schemas are `{description: <annotated prose>, allOf: [$ref X]}`: the prose is on the
    # wrapper and the constraints on X. Losing either would break the panel or the validator.
    rows, _ = invoice
    number = by_pointer(rows, "/document/number")[0]
    assert number["schema"] == "DocumentIdentifier"
    assert number["constraints"]["pattern"] == r"^[0-9A-Z_/\-\.]{1,20}$"
    assert number["constraints"]["maxLength"] == 20
    assert number["bt"] == ["BT-1"]


def test_specific_examples_survive_and_placeholders_do_not(invoice):
    rows, _ = invoice
    order = by_pointer(rows, "/document/references/purchase_order")[0]
    assert order["example"] == "PO-2025-001234"
    assert order["example_source"] == "DocumentReferencesPurchaseOrder"
    text = by_pointer(rows, "/entries/{i}/data/text")[0]
    assert text["example"] is None
    assert text["example_source"] == "PlainString256"
    assert text["constraints"]["maxLength"] == 256
    for row in rows:
        rendered = str(row["example"])
        for literal in PLACEHOLDER_LITERALS:
            assert literal not in rendered, (row["pointer"], row["example"])


def test_the_free_form_tag_maps_keep_their_object_example(invoice):
    rows, _ = invoice
    maps = [row for row in rows if row["kind"] == "map"]
    assert {row["pointer"] for row in maps} == {
        "/details/properties",
        "/entries/{i}/details/properties",
        "/payments/{i}/details/properties",
    }
    for row in maps:
        assert isinstance(row["example"], dict) and row["example"]


def test_every_placeholder_schema_still_exists_in_the_spec(schemas):
    missing = sorted(name for name in PLACEHOLDER_SCHEMAS if name not in schemas)
    assert missing == [], f"renamed or removed base types: {missing}"


def test_the_defaults_the_spec_declares_are_surfaced(invoice):
    rows, _ = invoice
    defaults = {
        row["pointer"]: row["constraints"]["default"]
        for row in rows
        if "default" in row["constraints"]
    }
    assert defaults["/entries/{i}/details/purpose"] == "STANDARD"
    assert defaults["/recipients/{i}/origin"] == "NATIONAL"
    assert defaults["/recipients/{i}/invoicing/format"] == "ZUGFERD_V2"


def test_per_country_applicability_is_parsed_for_all_three_profiles(invoice):
    rows, _ = invoice
    annotated = [row for row in rows if row["applicability"]]
    assert len(annotated) > 100
    for row in annotated:
        # Every annotated block in this spec enumerates all nine profiles, so a parse that
        # produced only some of ours means the prose convention moved.
        assert set(row["applicability"]) == set(PROFILES), row["pointer"]
        for verdict in row["applicability"].values():
            assert verdict["status"] in {
                "applicable",
                "not_required",
                "not_applicable",
                "not_supported",
            }


def test_italy_reports_the_fields_the_spec_calls_not_applicable(invoice):
    rows, _ = invoice
    inapplicable = {
        row["pointer"]
        for row in rows
        if row["applicability"].get("IT_EI", {}).get("status") == "not_applicable"
    }
    assert {
        "/entries/{i}/data/vat/regime",
        "/entries/{i}/data/vat/regime_base",
        "/entries/{i}/data/vat/surcharge/rate",
        "/entries/{i}/data/vat/surcharge/amount",
    } <= inapplicable


def test_germany_is_annotated_in_its_own_right_not_inherited_from_italy(invoice):
    # If applicability were ever silently substituted from another country, the two verdict
    # vectors would be identical. They are not: the email delivery format is DE-only.
    rows, _ = invoice
    differing = [
        row["pointer"]
        for row in rows
        if row["applicability"]
        and row["applicability"]["DE_EI"]["status"] != row["applicability"]["IT_EI"]["status"]
    ]
    assert differing
    fmt = by_pointer(rows, "/recipients/{i}/invoicing/format")[0]
    assert fmt["applicability"]["DE_EI"]["status"] == "applicable"
    assert fmt["applicability"]["IT_EI"]["status"] == "not_required"


def test_the_walker_consumes_every_keyword_the_spec_uses(schemas):
    """A future spec adding a constraint we do not read must fail the build, not be dropped.

    `mapping`, `example`, `enum` and `default` hold arbitrary user data — descending into them
    makes enum members and tag keys masquerade as keywords, so they are treated as opaque.
    """
    found = set()

    def walk(node):
        # Only a schema node's own keys are keywords. `properties` maps property *names* to
        # schemas, `required` lists names, and mapping/example/enum/default hold user data —
        # descending into any of them collects business vocabulary, not keywords.
        if not isinstance(node, dict):
            return
        found.update(node.keys())
        for key, value in node.items():
            if key == "properties":
                for sub in value.values():
                    walk(sub)
            elif key in ("allOf", "oneOf", "anyOf"):
                for sub in value:
                    walk(sub)
            elif key in ("items", "additionalProperties", "not"):
                walk(value)

    for name in _reachable(schemas):
        walk(schemas[name])
    vendor = {key for key in found if key.startswith("x-")}
    unknown = found - STRUCTURAL_KEYWORDS - set(CONSTRAINT_KEYWORDS) - vendor
    assert unknown == set(), f"unread schema keywords: {sorted(unknown)}"


def _reachable(schemas):
    seen, frontier = set(), set(OPERATION_SCHEMAS.values())
    while frontier:
        name = frontier.pop()
        if name in seen or name not in schemas:
            continue
        seen.add(name)
        refs = set()
        _collect_refs(schemas[name], refs)
        frontier |= refs - seen
    return seen


def _collect_refs(node, out):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                out.add(value.rsplit("/", 1)[1])
            else:
                _collect_refs(value, out)
    elif isinstance(node, list):
        for value in node:
            _collect_refs(value, out)


def test_a_correction_addresses_the_invoice_through_its_data_wrapper(schemas):
    rows, _ = extract(schemas, "CORRECTION")
    pointers = {row["pointer"] for row in rows}
    assert "/data/entries/{i}/data/text" in pointers
    assert "/reason" in pointers
    assert "/record/id" in pointers
    for row in rows:
        assert row["pointer"].startswith("/"), row["pointer"]


def test_the_payload_reports_its_source_and_profile_per_country():
    for country in COUNTRIES:
        payload = field_metadata(SPEC, country, "INVOICE")
        assert payload["country"] == country
        assert payload["profile"] == f"{country}_EI"
        assert payload["source_sha256"]
        assert payload["fields"]
        applicable = [row for row in payload["fields"] if row["applicable"]]
        assert 0 < len(applicable) <= len(payload["fields"])
