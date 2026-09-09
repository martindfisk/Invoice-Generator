"""check_updates.py: pure detection logic, fetchers injected — no network."""

import json

import check_updates
from check_updates import (
    check_fatturapa,
    check_rulesets,
    check_spec,
    parse_tag,
    version_key,
)

MANIFEST = {
    "sources": [
        {
            "id": "cen",
            "version": "1.3.15",
            "repo": "ConnectingEurope/eInvoicing-EN16931",
            "tag": "validation-{version}",
            "urlTemplate": "https://example.test/cen/{file}",
            "files": {"EN16931-UBL-validation.xslt": "aa"},
        },
        {
            "id": "peppol",
            "version": "3.0.20",
            "repo": "OpenPEPPOL/peppol-bis-invoice-3",
            "tag": "v{version}",
            "urlTemplate": "https://example.test/peppol/{file}",
            "files": {"PEPPOL-EN16931-UBL.sch": "bb"},
        },
        {
            "id": "ubl",
            "version": "2.1",
            "urlTemplate": "https://example.test/ubl/{file}",
            "files": {"UBL-Invoice-2.1.xsd": "cc"},
        },
        {
            "id": "fatturapa",
            "version": "1.2.3",
            "urlTemplate": "https://example.test/fpa/{file}",
            "files": {"Schema_VFPR12_v{version}.xsd": "dd"},
        },
    ],
    "ruleSets": [
        {"id": "en16931-cii", "source": "cen"},
        {"id": "peppol-ubl", "source": "peppol"},
        {"id": "cen-ubl", "source": "peppol"},
    ],
}


def gh_fetcher(releases):
    def fetcher(url, headers):
        for repo, payload in releases.items():
            if repo in url:
                return json.dumps(payload).encode()
        raise AssertionError(f"unexpected URL {url}")

    return fetcher


def test_version_key_orders_semver_numerically():
    assert version_key("1.3.15") < version_key("1.3.16")
    assert version_key("3.0.9") < version_key("3.0.20")
    assert version_key("2026-06-01") < version_key("2026-07-01")
    assert version_key("1.3.15") == version_key("1.3.15")


def test_parse_tag_both_templates_and_mismatch():
    assert parse_tag("validation-1.3.16", "validation-{version}") == "1.3.16"
    assert parse_tag("v3.0.21", "v{version}") == "3.0.21"
    assert parse_tag("release-2024", "v{version}") is None


def test_check_rulesets_detects_newer_release():
    fetcher = gh_fetcher(
        {
            "eInvoicing-EN16931": {
                "tag_name": "validation-1.3.16",
                "html_url": "https://example.test/rel/cen",
            },
            "peppol-bis-invoice-3": {"tag_name": "v3.0.20", "html_url": ""},
        }
    )
    updates = check_rulesets(MANIFEST, fetcher)
    assert len(updates) == 1
    (u,) = updates
    assert u["source"] == "cen"
    assert u["action"] == "pr"
    assert u["current"] == "1.3.15"
    assert u["latest"] == "1.3.16"
    assert u["branch"] == "update/cen-1.3.16"
    assert u["releaseUrl"] == "https://example.test/rel/cen"
    assert u["ruleSets"] == ["en16931-cii"]


def test_check_rulesets_lists_all_rule_sets_of_a_shared_source():
    fetcher = gh_fetcher(
        {
            "eInvoicing-EN16931": {"tag_name": "validation-1.3.15"},
            "peppol-bis-invoice-3": {"tag_name": "v3.0.21"},
        }
    )
    (u,) = check_rulesets(MANIFEST, fetcher)
    assert u["source"] == "peppol"
    assert u["ruleSets"] == ["peppol-ubl", "cen-ubl"]


def test_check_rulesets_unparseable_tag_is_a_warning_not_a_crash():
    fetcher = gh_fetcher(
        {
            "eInvoicing-EN16931": {"tag_name": "oddball"},
            "peppol-bis-invoice-3": {"tag_name": "v3.0.20"},
        }
    )
    (u,) = check_rulesets(MANIFEST, fetcher)
    assert u["action"] == "warning"
    assert u["source"] == "cen"
    assert "oddball" in u["message"]


def test_check_rulesets_only_filter():
    fetcher = gh_fetcher(
        {
            "eInvoicing-EN16931": {"tag_name": "validation-1.3.16"},
            "peppol-bis-invoice-3": {"tag_name": "v3.0.21"},
        }
    )
    updates = check_rulesets(MANIFEST, fetcher, only="peppol")
    assert [u["source"] for u in updates] == ["peppol"]


def test_check_rulesets_skips_sources_without_repo():
    fetcher = gh_fetcher(
        {
            "eInvoicing-EN16931": {"tag_name": "validation-1.3.15"},
            "peppol-bis-invoice-3": {"tag_name": "v3.0.20"},
        }
    )
    assert check_rulesets(MANIFEST, fetcher) == []  # ubl/fatturapa never queried


PRODUCTS = " ".join(
    f"https://workspace.fiskaly.com/specs/fiskaly.uapi.e-invoice-{cc}.{v}.yaml"
    for cc, v in [
        ("it", "2026-06-01"),
        ("it", "2026-08-01"),
        ("be", "2026-06-01"),
        ("de", "2026-06-01"),
    ]
)

SPEC_MANIFEST = {
    "spec": {"file": "fiskaly.unified-api.all.2026-06-01.yaml", "version": "2026-06-01"},
    "fallback": [
        {"country": "it", "version": "2026-06-01"},
        {"country": "be", "version": "2026-06-01"},
        {"country": "de", "version": "2026-06-01"},
    ],
}


def test_check_spec_detects_country_bump_and_drop_behind():
    (u,) = check_spec(SPEC_MANIFEST, PRODUCTS)
    assert u["source"] == "spec"
    assert u["action"] == "pr"
    assert u["version"] == "2026-08-01"
    assert u["branch"] == "update/spec-2026-08-01"
    assert "it=2026-08-01" in u["latest"]
    assert "it=2026-06-01" in u["current"]
    assert u["dropBehind"] is True


def test_check_spec_noop_when_current():
    stale_free = PRODUCTS.replace("2026-08-01", "2026-06-01")
    assert check_spec(SPEC_MANIFEST, stale_free) == []


def test_check_spec_drop_current_when_it_matches_newest():
    manifest = dict(SPEC_MANIFEST, spec={"version": "2026-08-01"})
    (u,) = check_spec(manifest, PRODUCTS)
    assert u["dropBehind"] is False


def test_check_fatturapa_drift_vs_match():
    xsd = b"<xsd/>"
    pinned = check_updates.sha256(xsd)
    manifest = {
        "sources": [
            {
                "id": "fatturapa",
                "version": "1.2.3",
                "urlTemplate": "https://example.test/fpa/{file}",
                "files": {"Schema_VFPR12_v{version}.xsd": pinned},
            }
        ]
    }
    assert check_fatturapa(manifest, lambda url, timeout=60: xsd) == []

    (u,) = check_fatturapa(manifest, lambda url, timeout=60: b"<changed/>")
    assert u["action"] == "issue"
    assert u["source"] == "fatturapa"
    assert "Schema_VFPR12_v1.2.3.xsd" in u["details"][0]
