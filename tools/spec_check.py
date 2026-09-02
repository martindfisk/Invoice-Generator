#!/usr/bin/env python3
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC_DIR = ROOT / "spec"
DROP_DIR = SPEC_DIR / "drop"
MANIFEST = SPEC_DIR / "spec.json"
GEN_TYPES = ROOT / "frontend" / "src" / "gen" / "uapi.d.ts"
RUN_SPEC = "run: make spec"


def active_spec_file(manifest):
    """The spec gen-types and the backend resolve against: the dropped one, else IT."""
    if manifest.get("spec"):
        return manifest["spec"]["file"]
    for entry in manifest.get("fallback", []):
        if entry["country"] == "it":
            return entry["file"]
    return None


def listed(manifest):
    names = {e["file"] for e in manifest.get("fallback", [])}
    names |= {e["file"] for e in manifest.get("collections", [])}
    if manifest.get("spec"):
        names.add(manifest["spec"]["file"])
    return names


def check(include_types):
    errors = []
    if not MANIFEST.exists():
        return [f"spec/spec.json is missing — {RUN_SPEC}"]
    try:
        manifest = json.loads(MANIFEST.read_text())
    except json.JSONDecodeError as e:
        return [f"spec/spec.json is not valid JSON ({e}) — {RUN_SPEC}"]

    entries = list(manifest.get("fallback", [])) + list(manifest.get("collections", []))
    if manifest.get("spec"):
        entries.append(manifest["spec"])
    for entry in entries:
        path = SPEC_DIR / entry["file"]
        if not path.exists():
            errors.append(f"{entry['file']} is listed in spec.json but missing — {RUN_SPEC}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry["sha256"]:
            errors.append(
                f"{entry['file']} sha256 {digest[:12]} != recorded {entry['sha256'][:12]}; "
                f"it changed after ingestion — {RUN_SPEC}"
            )

    version_file = SPEC_DIR / "version.txt"
    if not version_file.exists():
        errors.append(f"spec/version.txt is missing — {RUN_SPEC}")
    elif version_file.read_text().strip() != manifest.get("apiVersion"):
        errors.append(
            f"spec/version.txt {version_file.read_text().strip()!r} != "
            f"spec.json apiVersion {manifest.get('apiVersion')!r} — {RUN_SPEC}"
        )

    known = listed(manifest)
    for stray in sorted(SPEC_DIR.glob("*.y*ml")):
        if stray.name not in known:
            errors.append(
                f"{stray.name} sits in spec/ but is not listed in spec.json; "
                f"drop it into spec/drop/ instead — {RUN_SPEC}"
            )

    if DROP_DIR.is_dir():
        pending = sorted(p.name for p in DROP_DIR.glob("*.y*ml"))
        if pending:
            errors.append(
                f"spec/drop/ still holds {', '.join(pending)} — not ingested yet — {RUN_SPEC}"
            )

    active = active_spec_file(manifest)
    if active is None:
        errors.append(f"spec.json records no active spec — {RUN_SPEC}")
    elif not include_types:
        pass
    elif not GEN_TYPES.exists():
        errors.append("frontend/src/gen/uapi.d.ts is missing — run: make gen-types")
    elif GEN_TYPES.stat().st_mtime < (SPEC_DIR / active).stat().st_mtime:
        errors.append(
            f"frontend/src/gen/uapi.d.ts is older than {active} — run: make gen-types"
        )
    return errors


def main():
    ap = argparse.ArgumentParser(
        description="Check that spec/ matches spec/spec.json and that generated types are fresh"
    )
    ap.add_argument(
        "--types",
        action="store_true",
        help="also fail when frontend/src/gen/uapi.d.ts is missing or older than the active spec",
    )
    args = ap.parse_args()
    errors = check(args.types)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        return 1
    manifest = json.loads(MANIFEST.read_text())
    print(f"spec ok (X-Api-Version {manifest['apiVersion']}, {active_spec_file(manifest)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
