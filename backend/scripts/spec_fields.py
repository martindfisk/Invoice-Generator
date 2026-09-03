#!/usr/bin/env python3
"""Dump the fiskaly field inventory as JSON, one entry per supported country.

Lives here and not in tools/ on purpose: every tools/*.py is stdlib-only and runs on the system
python3 because `make setup` invokes them before the backend venv exists. This one imports
app.fields, so it needs that venv — run it with backend/.venv/bin/python.

    python backend/scripts/spec_fields.py > fields.json
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.fields import field_metadata  # noqa: E402
from app.settings import COUNTRIES, Settings  # noqa: E402


def main() -> int:
    settings = Settings(_env_file=None)
    dumped = {}
    for country in COUNTRIES:
        try:
            payload = field_metadata(settings.spec_dir, country, "INVOICE")
        except (FileNotFoundError, KeyError, ValueError) as exc:
            print(f"ERROR: {country}: {exc}; run: make spec", file=sys.stderr)
            return 1
        payload["api_version"] = settings.uapi_api_version
        dumped[country] = payload
    json.dump(dumped, sys.stdout, indent=None, sort_keys=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
