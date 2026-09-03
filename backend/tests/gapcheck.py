"""Loaders and shared predicates for the gap-report checks.

The report is folded in TypeScript, where the mapping tables and the BT catalogue live. These
checks read the same truths through the JSON the generator dumps beside it, so nothing here
re-implements the fold and the two halves cannot drift apart silently.
"""

import json
from pathlib import Path

from app.fields import field_metadata
from app.settings import Settings

ROOT = Path(__file__).resolve().parents[2]
GAPS = ROOT / "docs" / "gaps"
REPORT = GAPS / "gap-report.json"
INPUTS = GAPS / "inputs"
CATALOG = ROOT / "frontend" / "src" / "bt-catalog.json"
SRC = ROOT / "frontend" / "src"

# Each country files one syntax; DE files two. A row's format must be one a country actually sends.
COUNTRY_OF = {"fatturapa": "IT", "ubl": "BE", "xrechnung": "DE", "cii": "DE"}
MISSING_FROM = {"model", "json", "xml"}
SEVERITIES = {"blocking", "should-fix", "note"}
STATUSES = {"applicable", "not_required", "not_applicable", "not_supported"}


def available() -> bool:
    return REPORT.exists() and INPUTS.is_dir()


def rows() -> list[dict]:
    return json.loads(REPORT.read_text())


def inputs(name: str):
    return json.loads((INPUTS / f"{name}.json").read_text())


def catalogue() -> dict[str, dict]:
    return {entry["id"]: entry for entry in json.loads(CATALOG.read_text())}


_spec: dict[str, dict] = {}


def spec_for(country: str) -> dict:
    if country not in _spec:
        settings = Settings(_env_file=None)
        _spec[country] = field_metadata(settings.spec_dir, country, "INVOICE")
    return _spec[country]


def spec_pointers(country: str) -> dict[str, dict]:
    return {entry["pointer"]: entry for entry in spec_for(country)["fields"]}


def declared_reasons() -> set[str]:
    return {reason for group in inputs("declared-reasons").values() for reason in group}


def is_pointer(value: str) -> bool:
    return value.startswith("/")
