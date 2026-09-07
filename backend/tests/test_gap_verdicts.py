"""Guards on docs/gaps/verdicts.json, the output of the /gap-audit research run.

A verdict is only worth keeping while the claim it judged still exists and still says the same
thing. These are the staleness checks from test_golden_xsd.py applied to research output: an
orphaned verdict, or one attached to a reason that has since been reworded, fails loudly instead of
quietly reassuring the team.
"""

import json
from pathlib import Path

import pytest

from tests import gapcheck

VERDICTS = gapcheck.GAPS / "verdicts.json"
STATUSES = {"confirmed", "refuted", "unproven"}
SOURCE_KINDS = {"vendor", "local", "repo", "web"}
# Narrative Peppol guidance is the one thing the offline corpus cannot settle.
WEB_ALLOWLIST = ("docs.peppol.eu", "ferd-net.de", "xoev.de", "agenziaentrate.gov.it")

pytestmark = pytest.mark.skipif(
    not (gapcheck.available() and VERDICTS.exists()),
    reason="docs/gaps/verdicts.json missing — run the /gap-audit workflow",
)

ROWS = gapcheck.rows() if gapcheck.available() else []
CLAIMS = json.loads(VERDICTS.read_text())["claims"] if VERDICTS.exists() else []


def test_every_verdict_names_rows_that_still_exist():
    known = {row["id"] for row in ROWS}
    orphaned = sorted({row_id for claim in CLAIMS for row_id in claim["rowIds"]} - known)
    assert orphaned == [], f"verdicts reference rows the report no longer has: {orphaned[:10]}"


def test_every_verdict_still_matches_the_reason_it_judged():
    # A reworded reason is a different claim; the old verdict must not silently carry over.
    reasons = {row["reason"] for row in ROWS}
    drifted = sorted({claim["reason"] for claim in CLAIMS} - reasons)
    assert drifted == [], (
        "these reasons were re-worded after they were reviewed — re-run /gap-audit and review the "
        f"diff: {drifted[:5]}"
    )


def test_every_blocking_row_has_been_reviewed():
    judged = {row_id for claim in CLAIMS for row_id in claim["rowIds"]}
    blocking = {row["id"] for row in ROWS if row["severity"] == "blocking"}
    assert blocking - judged == set(), f"unreviewed blocking rows: {sorted(blocking - judged)}"


def test_every_should_fix_cause_has_been_reviewed():
    # The report currently grades no row `blocking`, which would leave the test above vacuous —
    # the audit's actual working tier is should-fix. Claims carry sample row ids per cause, so
    # coverage is asserted per cause (verbatim reason), not per row.
    judged = {claim["reason"] for claim in CLAIMS}
    should_fix = {row["reason"] for row in ROWS if row["severity"] == "should-fix"}
    unreviewed = sorted(should_fix - judged)
    assert unreviewed == [], f"unreviewed should-fix causes: {unreviewed[:5]}"


def test_every_verdict_uses_the_declared_vocabulary():
    for claim in CLAIMS:
        assert claim["status"] in STATUSES, claim
        assert claim["source"]["kind"] in SOURCE_KINDS, claim


def test_every_offline_citation_points_at_something_that_exists():
    # A verdict whose source cannot be opened is worth nothing, and the distinction between an
    # offline citation and a fetched one is the point of recording the kind at all.
    missing = []
    for claim in CLAIMS:
        source = claim["source"]
        if source["kind"] == "web":
            assert any(host in source["ref"] for host in WEB_ALLOWLIST), source["ref"]
            assert source.get("retrievedAt"), f"web citation without retrievedAt: {source['ref']}"
            continue
        ref = source["ref"].split("#", 1)[0].split(":", 1)[0]
        path = Path(ref) if Path(ref).is_absolute() else gapcheck.ROOT / ref
        if not path.exists():
            missing.append(f"{source['kind']}:{source['ref']}")
    assert missing == [], f"citations that do not resolve: {missing}"


def test_a_refuted_claim_is_visible_rather_than_buried():
    refuted = [claim for claim in CLAIMS if claim["status"] == "refuted"]
    for claim in refuted:
        assert claim["verifier"]["reason"], f"{claim['proposition']} refuted without a reason"
