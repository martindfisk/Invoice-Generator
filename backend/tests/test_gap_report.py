import pytest

from tests import gapcheck

pytestmark = pytest.mark.skipif(
    not gapcheck.available(), reason="docs/gaps/ missing — run: make gap-report"
)

ROWS = gapcheck.rows() if gapcheck.available() else []
CATALOG = gapcheck.catalogue() if gapcheck.available() else {}
MODEL_FIELDS = set(gapcheck.inputs("model-fields")) if gapcheck.available() else set()
POINTER_FIELDS = gapcheck.inputs("pointer-fields") if gapcheck.available() else {}
DECLARED = gapcheck.declared_reasons() if gapcheck.available() else set()


def ids(subset):
    return [row["id"] for row in subset]


def test_the_report_is_not_empty_and_stays_triageable():
    assert 150 < len(ROWS) < 500, f"{len(ROWS)} rows — a filter is probably wrong"
    assert len({row["reason"] for row in ROWS}) < 60


def test_every_row_has_a_unique_well_formed_id():
    seen = [row["id"] for row in ROWS]
    assert len(set(seen)) == len(seen)
    for row in ROWS:
        prefix = "operation" if row["missingFrom"] == "model" else row["format"]
        key = row["belongsAt"] if row["missingFrom"] == "model" else row["field"]
        assert row["id"] == f"{prefix}|{key}|{row['missingFrom']}", row["id"]


def test_every_row_uses_the_declared_enums():
    for row in ROWS:
        assert row["missingFrom"] in gapcheck.MISSING_FROM, row["id"]
        assert row["severity"] in gapcheck.SEVERITIES, row["id"]
        assert row["format"] in gapcheck.COUNTRY_OF, row["id"]


def test_no_gap_is_reported_twice():
    keys = [(row["field"], row["belongsAt"], row["format"], row["missingFrom"]) for row in ROWS]
    assert len(set(keys)) == len(keys)


def test_every_row_names_a_real_model_field_or_is_an_orphan():
    for row in ROWS:
        if row["missingFrom"] == "model":
            # An orphan is a pointer with no model field; naming one would contradict the claim.
            assert row["field"] == "", row["id"]
        else:
            assert row["field"] in MODEL_FIELDS, row["id"]


def test_every_business_term_resolves_against_the_catalogue():
    for row in ROWS:
        if row["bt"] is None:
            continue
        entry = CATALOG.get(row["bt"])
        assert entry is not None, f"{row['id']} cites {row['bt']}"
        assert row["bg"] == entry["group"], row["id"]
        assert row["cardinality"] == entry["cardinality"], row["id"]


def test_every_reason_is_quoted_verbatim_from_a_declared_table():
    # The generator must not paraphrase: a reason is either a key of a declared loss table or one
    # of the three sentences it owns. Anything else is prose invented in a report generator.
    for row in ROWS:
        assert row["reason"] in DECLARED, f"{row['id']}: {row['reason']!r}"


def test_a_json_or_xml_target_is_a_pointer_the_spec_has_or_a_term_the_catalogue_has():
    for row in ROWS:
        if row["missingFrom"] == "model":
            continue
        target = row["belongsAt"]
        if gapcheck.is_pointer(target):
            country = gapcheck.COUNTRY_OF[row["format"]]
            assert target in gapcheck.spec_pointers(country), f"{row['id']} -> {target}"
        else:
            assert target in CATALOG or target in MODEL_FIELDS, f"{row['id']} -> {target}"


def test_an_orphan_pointer_really_is_one():
    for row in ROWS:
        if row["missingFrom"] != "model":
            continue
        pointer = row["belongsAt"]
        assert gapcheck.is_pointer(pointer), row["id"]
        # It must exist in at least one country's contract, and be addressed by no model field.
        assert any(pointer in gapcheck.spec_pointers(c) for c in ("IT", "BE", "DE")), row["id"]
        assert pointer not in POINTER_FIELDS, row["id"]


def test_presentin_never_claims_the_structure_the_row_says_is_missing():
    for row in ROWS:
        clauses = [part.strip() for part in row["presentIn"].split(";")]
        parts = dict(clause.split(" ", 1) for clause in clauses if " " in clause)
        structure = "model" if row["missingFrom"] == "model" else row["missingFrom"]
        assert parts.get(structure, "—") == "—", f"{row['id']}: {row['presentIn']}"


def test_applicability_is_reported_in_the_spec_s_own_vocabulary():
    for row in ROWS:
        if not row["applicability"]:
            continue
        for clause in row["applicability"].split(";"):
            profile, status = (piece.strip() for piece in clause.split(":", 1))
            assert profile in {"IT_EI", "BE_EI", "DE_EI"}, row["id"]
            assert status in gapcheck.STATUSES, row["id"]


def test_every_source_names_something_that_exists_and_the_rule_that_set_the_severity():
    symbols = set(gapcheck.inputs("declared-reasons"))
    spec_source = gapcheck.spec_for("IT")["source"]
    for row in ROWS:
        origin, where, rule = (piece.strip() for piece in row["source"].split("·"))
        assert origin in {"structural", "spec"}, row["id"]
        assert rule in {"R1", "R2", "R3", "R4"}, row["id"]
        known = where in symbols or where == spec_source or (gapcheck.SRC / where).exists()
        assert known, f"{row['id']} cites {where!r}"


def test_blocking_is_reserved_for_a_mandatory_term_the_syntax_cannot_render():
    # An empty tier is a result, not a failure: every mandated CIUS syntax currently renders every
    # term EN 16931 makes mandatory. R1 firing at all is proved by the unit test on severityFor;
    # here we only check that anything claiming the tier has earned it.
    blocking = [row for row in ROWS if row["severity"] == "blocking"]
    for row in blocking:
        assert row["missingFrom"] == "xml", row["id"]
        assert (row["cardinality"] or "").startswith("1"), row["id"]
        assert row["source"].endswith("R1"), row["id"]
        # FatturaPA is a national format, not a CIUS of EN 16931, so EN cardinality cannot
        # make one of its rows blocking.
        assert row["format"] != "fatturapa", row["id"]


def test_a_field_fiskaly_supplies_itself_is_never_blocking():
    # BT-3 is derived and the seller identity comes from the commissioned Taxpayer. Both are
    # mandatory; calling them blocking buried the handful of rows that genuinely are.
    by_design = [
        row
        for row in ROWS
        if "taxpayer resource" in row["reason"] or "derived by fiskaly" in row["reason"]
    ]
    assert len(by_design) > 5
    assert [row["id"] for row in by_design if row["severity"] == "blocking"] == []


def test_evidence_says_unobserved_rather_than_leaving_a_syntax_blank():
    # Absence of a capture is not evidence that a field is dropped; the two must read
    # differently. "Derived:" is the third shape: the spec's own account schemas (Taxpayer,
    # System) are the evidence that fiskaly supplies the datum, no capture needed.
    for row in ROWS:
        if row["format"] == "fatturapa" or row["missingFrom"] == "model":
            continue
        evidence = row["evidence"] or ""
        assert evidence.startswith(("Unobserved:", "Derived:")), row["id"]
