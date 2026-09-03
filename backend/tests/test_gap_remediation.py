"""Does the target each row proposes actually validate?

A gap row says "this field belongs at that address". For a JSON pointer that claim is testable:
put a schema-legal value there and ask the contract validator. A proposed target that would be
rejected is a bug in the report, and this catches it before the team files a ticket for it.
"""

import copy
import json

import pytest

from app.validate import UapiSchemaValidator
from tests import gapcheck

pytestmark = pytest.mark.skipif(
    not gapcheck.available(), reason="docs/gaps/ missing — run: make gap-report"
)

GOLDEN = gapcheck.ROOT / "frontend" / "tests" / "golden"
# The invoice each country files, and the operation the remediation is spliced into.
SHAPE = {"IT": "it-b2b-sdi", "BE": "be-peppol", "DE": "de-hotel-b2g-xrechnung"}

# A target that cannot be reached without also building something else. The value is a substring
# that must appear in the reason, so an entry going stale is loud rather than silently permissive.
KNOWN_UNREACHABLE: dict[str, str] = {
    # FiscalLocation is an anyOf with no discriminator; nothing in the payload picks the arm.
    "operation|/entries/{i}/data/vat/fiscal_location/region|model": "has no discriminator",
    # InvoiceDetails.creators is a required array the invoice never opens, so there is no member
    # to write a creator into. The ticket is "model the details block", not "set this field".
    "operation|/details/creators/{i}/label|model": "has no member to write into",
    "operation|/details/creators/{i}/type|model": "has no member to write into",
    "operation|/details/creators/{i}/name/forename|model": "has no member to write into",
    "operation|/details/creators/{i}/name/gender|model": "has no member to write into",
    "operation|/details/creators/{i}/name/surname|model": "has no member to write into",
}

ROWS = gapcheck.rows() if gapcheck.available() else []
TARGETS = [row for row in ROWS if gapcheck.is_pointer(row["belongsAt"])]


def operation_for(country: str) -> dict:
    return json.loads((GOLDEN / f"{SHAPE[country]}.uapi.json").read_text())


def value_for(entry: dict):
    """The same order suggestedValue() uses: a real example, else an enum member, else a default."""
    if entry.get("example") is not None:
        return entry["example"]
    constraints = entry.get("constraints") or {}
    if constraints.get("enum"):
        return constraints["enum"][0]
    if constraints.get("default") is not None:
        return constraints["default"]
    return None


def branch_value(operation: dict, spec: dict, axis: str) -> str | None:
    """The `oneOf` arm this invoice actually chose at `axis`, e.g. CREDIT_TRANSFER."""
    union = next((u for u in spec["unions"] if u["pointer"] == axis), None)
    prop = (union or {}).get("property_name") or "type"
    node = operation
    for raw in axis.split("/")[1:]:
        key = "0" if raw == "{i}" else raw
        if isinstance(node, list):
            position = int(key)
            if position >= len(node):
                return None
            node = node[position]
        elif isinstance(node, dict):
            if key not in node:
                return None
            node = node[key]
        else:
            return None
    return node.get(prop) if isinstance(node, dict) else None


def in_scope(operation: dict, spec: dict, entry: dict) -> bool:
    """Is this field part of the shape the invoice actually sends?

    Without this, the required siblings of `/payments/{i}/instruction` include DIRECT_DEBIT's
    mandate_reference even though the invoice sends a CREDIT_TRANSFER — the unchosen-arm case
    insertBlocker() refuses in the UI.
    """
    for axis, allowed in (entry.get("variants") or {}).items():
        chosen = branch_value(operation, spec, axis)
        if chosen is not None and chosen not in allowed:
            return False
    return True


def ambiguous_arm(operation: dict, spec: dict, entry: dict) -> str | None:
    """An arm nothing has chosen, which nothing can choose for it.

    FiscalLocation is an anyOf with no discriminator — France, Portugal and a generic country, told
    apart only by a `country` const. Splicing in the Portuguese `region` beside a generic `country`
    produces exactly the invalid mix this returns a reason for.
    """
    for axis in entry.get("variants") or {}:
        union = next((u for u in spec["unions"] if u["pointer"] == axis), None)
        if branch_value(operation, spec, axis) is None and not (union or {}).get("property_name"):
            return f"the arm at {axis} is not chosen and has no discriminator to choose it by"
    return None


def companions(pointers: dict, target: dict) -> list[dict]:
    """The siblings the schema requires alongside a newly created optional block.

    Inserting `/tax_representative/country` on its own leaves `name` and `vat_number` missing, and
    the contract rightly rejects that. The UI solves this with companions() in uapi-fields.ts; this
    is the same rule read off the same spec metadata, so the two cannot disagree.
    """
    ancestor = target.get("optional_ancestor")
    if ancestor is None:
        return []
    return [
        entry
        for entry in pointers.values()
        if entry is not target
        and entry.get("optional_ancestor") == ancestor
        and entry.get("required")
        and entry.get("kind") in {"leaf", "map"}
    ]


def present(operation: dict, pointer: str) -> bool:
    node = operation
    for raw in pointer.split("/")[1:]:
        key = "0" if raw == "{i}" else raw
        if isinstance(node, list):
            position = int(key)
            if position >= len(node):
                return False
            node = node[position]
        elif isinstance(node, dict):
            if key not in node:
                return False
            node = node[key]
        else:
            return False
    return node is not None


def insert(operation: dict, pointer: str, value, pointers: dict | None = None) -> str | None:
    pointers = pointers or {}
    """Write `value` at `pointer`, or return why the target cannot be reached."""
    segments = pointer.split("/")[1:]
    node = operation
    for index, raw in enumerate(segments):
        last = index == len(segments) - 1
        key = "0" if raw == "{i}" else raw
        if isinstance(node, list):
            position = int(key)
            if position >= len(node):
                return f"the array at {'/'.join(segments[:index])} has no member {position}"
            if last:
                node[position] = value
                return None
            node = node[position]
            continue
        if not isinstance(node, dict):
            return f"{'/'.join(segments[:index])} is not an object"
        if raw == "{i}":
            return f"{'/'.join(segments[:index])} is not an array"
        if last:
            node[key] = value
            return None
        if key not in node:
            ahead = "/" + "/".join(segments[: index + 1])
            if (pointers.get(ahead) or {}).get("type") == "array":
                return f"the array at {ahead} has no member to write into"
        node = node.setdefault(key, {})
    return None


def _spec_dir():
    from app.settings import Settings

    return Settings(_env_file=None).spec_dir


def attempt(row: dict) -> tuple[str, object]:
    """Try to reach a row's proposed target. One code path, so both tests agree by construction.

    Returns ("ok", operation) when the target was written and its in-scope required siblings filled;
    ("skip", why) when the spec offers no value to write; ("blocked", why) when the shape of the
    payload makes the target unreachable.
    """
    country = gapcheck.COUNTRY_OF[row["format"]]
    spec = gapcheck.spec_for(country)
    pointers = gapcheck.spec_pointers(country)
    entry = pointers.get(row["belongsAt"])
    if entry is None:
        return "blocked", f"the spec has no {row['belongsAt']}"

    value = value_for(entry)
    if value is None:
        return "skip", f"the spec offers no value for {row['belongsAt']}"

    operation = operation_for(country)
    blocked = insert(operation, row["belongsAt"], value, pointers)
    if blocked is not None:
        return "blocked", blocked

    for sibling in companions(pointers, entry):
        if not in_scope(operation, spec, sibling) or present(operation, sibling["pointer"]):
            continue
        sibling_value = value_for(sibling)
        if sibling_value is None:
            return "skip", f"the spec offers no value for required sibling {sibling['pointer']}"
        insert(operation, sibling["pointer"], sibling_value, pointers)

    result = UapiSchemaValidator(_spec_dir()).validate(operation, country)
    if result["valid"]:
        return "ok", operation
    # An arm nothing chose is a property of the payload's shape, not a defect in the row.
    arm = ambiguous_arm(operation, spec, entry)
    if arm is not None:
        return "blocked", arm
    return "invalid", result["findings"][:3]


def test_there_is_something_to_check():
    assert len(TARGETS) > 20, "no row proposes a JSON pointer; the payload leg would be vacuous"


@pytest.mark.parametrize("row", TARGETS, ids=[row["id"] for row in TARGETS])
def test_each_proposed_pointer_is_reachable_and_validates(row):
    status, detail = attempt(row)
    if status == "skip":
        pytest.skip(str(detail))
    if status == "blocked":
        marker = KNOWN_UNREACHABLE.get(row["id"])
        assert marker is not None, f"{row['id']} is unreachable: {detail}"
        assert marker in str(detail), f"{row['id']}: {detail!r} no longer matches {marker!r}"
        return
    assert status == "ok", (
        f"{row['id']} proposes {row['belongsAt']}, which the contract rejects: {detail}"
    )


def test_known_unreachable_entries_all_exist():
    # The staleness guard from test_golden_xsd.py: an allowance for a row that no longer exists
    # would quietly excuse nothing.
    stale = set(KNOWN_UNREACHABLE) - {row["id"] for row in ROWS}
    assert stale == set(), f"stale KNOWN_UNREACHABLE entries: {sorted(stale)}"


def test_no_proposed_target_is_rejected_by_the_contract():
    # The claim worth making is that nothing the report proposes would be rejected. How many can be
    # proved is reported, not asserted: most skips are the spec suppressing a placeholder example,
    # which says nothing about the row.
    outcomes = [attempt(row)[0] for row in TARGETS]
    tally = {status: outcomes.count(status) for status in ("ok", "skip", "blocked", "invalid")}
    assert tally["invalid"] == 0, f"{tally['invalid']} target(s) the contract rejects"
    assert tally["ok"] > 0, f"nothing could be proved at all: {tally}"
    print(f"remediation targets: {tally}")


def test_the_whole_remediation_validates_per_country():
    """Every reachable target for a country at once — the end state a ticket asks for."""
    scope = {"IT": {"fatturapa"}, "BE": {"ubl"}, "DE": {"xrechnung", "cii"}}
    for country, formats in scope.items():
        operation = operation_for(country)
        pointers = gapcheck.spec_pointers(country)
        applied = 0
        validator = UapiSchemaValidator(_spec_dir())
        for row in TARGETS:
            if row["missingFrom"] != "model" and row["format"] not in formats:
                continue
            if attempt(row)[0] != "ok":
                continue
            # Apply cumulatively, keeping what still validates.
            candidate = copy.deepcopy(operation)
            entry = pointers[row["belongsAt"]]
            insert(candidate, row["belongsAt"], value_for(entry), pointers)
            for sibling in companions(pointers, entry):
                if in_scope(candidate, gapcheck.spec_for(country), sibling) and not present(
                    candidate, sibling["pointer"]
                ):
                    sibling_value = value_for(sibling)
                    if sibling_value is not None:
                        insert(candidate, sibling["pointer"], sibling_value, pointers)
            if validator.validate(candidate, country)["valid"]:
                operation = candidate
                applied += 1
        assert applied > 0, f"{country}: nothing applied"
        result = validator.validate(operation, country)
        assert result["valid"], f"{country}: {applied} targets applied, {result['findings'][:3]}"
        print(f"{country}: {applied} remediation target(s) co-exist and validate")
