#!/usr/bin/env python3
"""Detect upstream updates without applying them.

Three checks, all read-only:
  - spec: latest per-country UAPI CalVers from products.json vs spec/spec.json fallbacks
  - rulesets: GitHub /releases/latest per source that carries both `repo` and `tag`
    in tools/rulesets.json vs the pinned version (skips drafts and prereleases)
  - fatturapa: refetch the pinned XSD and compare its sha256 (no release feed exists)

Output: JSON {checkedAt, updates[]} to --output (default stdout); a human summary on
stderr. Exit 0 means the check ran, whether or not updates exist — a scheduled run
must not go red just because upstream moved. Exit 1 is an operational error (missing
manifest, bad arguments). A single unreachable upstream degrades to an
action: "warning" entry instead of failing the whole run, so one flaky host cannot
mask updates elsewhere.

Update entries drive .github/workflows/upstream-watch.yml:
  action "pr"      -> {source, kind, current, latest, version, branch, title, ...}
  action "issue"   -> FatturaPA sha drift (needs manual fatturapa-rules.ts review)
  action "warning" -> {source, message}
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetch_assets import load_manifest, sha256, source_files, source_url
from fetch_spec import (
    PRODUCTS_URL,
    SPEC_DIR,
    fetch,
    latest_versions,
    ssl_context,
    utcnow,
)

GITHUB_LATEST = "https://api.github.com/repos/{repo}/releases/latest"
NETWORK_ERRORS = (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError)


def version_key(version):
    """Sortable key for dotted/dashed versions: semver (1.3.16) and CalVer (2026-06-01)."""
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part)
        for part in re.split(r"[.\-]", str(version))
        if part
    )


def parse_tag(tag, template):
    """Invert a tag template like 'validation-{version}'; None when the tag doesn't fit."""
    pattern = re.escape(template).replace(re.escape("{version}"), "(?P<version>.+)")
    match = re.fullmatch(pattern, tag)
    return match.group("version") if match else None


def github_fetch(url, headers):
    request = urllib.request.Request(
        url, headers={"User-Agent": "invoice-generator/check_updates", **headers}
    )
    with urllib.request.urlopen(request, timeout=30, context=ssl_context()) as response:
        return response.read()


def latest_release(repo, fetcher, token=None):
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.loads(fetcher(GITHUB_LATEST.format(repo=repo), headers))
    return data["tag_name"], data.get("html_url", "")


def check_rulesets(manifest, fetcher, token=None, only=None):
    updates = []
    for src in manifest["sources"]:
        repo, tag_template = src.get("repo"), src.get("tag")
        if not repo or not tag_template:
            continue
        if only and src["id"] != only:
            continue
        try:
            tag, release_url = latest_release(repo, fetcher, token)
        except NETWORK_ERRORS as exc:
            updates.append(warning(src["id"], f"release lookup failed: {exc}"))
            continue
        latest = parse_tag(tag, tag_template)
        if latest is None:
            updates.append(
                warning(
                    src["id"],
                    f"release tag {tag!r} does not match template {tag_template!r}",
                )
            )
            continue
        if version_key(latest) > version_key(src["version"]):
            updates.append(
                {
                    "source": src["id"],
                    "kind": "ruleset",
                    "action": "pr",
                    "current": src["version"],
                    "latest": latest,
                    "version": latest,
                    "branch": f"update/{src['id']}-{latest}",
                    "title": f"Upstream: {src['id']} {src['version']} -> {latest}",
                    "releaseUrl": release_url,
                    "ruleSets": [
                        rs["id"] for rs in manifest["ruleSets"] if rs["source"] == src["id"]
                    ],
                    "dropBehind": False,
                }
            )
    return updates


def check_fatturapa(manifest, fetcher):
    src = next(s for s in manifest["sources"] if s["id"] == "fatturapa")
    drifted = []
    for name, pin, _zip, _member in source_files(src):
        url = source_url(src, name)
        try:
            digest = sha256(fetcher(url, timeout=60))
        except NETWORK_ERRORS as exc:
            return [warning("fatturapa", f"XSD fetch failed: {exc}")]
        if digest != pin:
            drifted.append(f"{name}: sha256 {digest} != pinned {pin}")
    if not drifted:
        return []
    return [
        {
            "source": "fatturapa",
            "kind": "sha-drift",
            "action": "issue",
            "current": src["version"],
            "title": f"fatturapa XSD drift (pinned {src['version']})",
            "details": drifted,
        }
    ]


def check_spec(spec_manifest, products_text):
    latest = latest_versions(products_text)
    current = {e["country"]: e["version"] for e in spec_manifest.get("fallback", [])}
    if not any(v > current.get(cc, "") for cc, v in latest.items()):
        return []
    newest = max(latest.values())
    drop = spec_manifest.get("spec") or {}
    return [
        {
            "source": "spec",
            "kind": "spec",
            "action": "pr",
            "current": summarize(current),
            "latest": summarize(latest),
            "version": newest,
            "branch": f"update/spec-{newest}",
            "title": f"Upstream: UAPI per-country specs -> {newest}",
            "releaseUrl": "",
            "ruleSets": [],
            "dropBehind": bool(drop) and drop.get("version", "") < newest,
        }
    ]


def summarize(per_country):
    return " ".join(f"{cc}={per_country[cc]}" for cc in sorted(per_country))


def warning(source, message):
    return {"source": source, "action": "warning", "message": message}


def read_products(url):
    if "://" not in url:
        return Path(url).read_text()
    return fetch(url).decode()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--output", help="write the JSON result here instead of stdout")
    ap.add_argument("--products-url", default=PRODUCTS_URL, help="URL or local file")
    ap.add_argument("--only", help="check a single source id (spec, cen, peppol, ...)")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    manifest = load_manifest()
    updates = []

    if args.only in (None, "spec"):
        spec_json = SPEC_DIR / "spec.json"
        if not spec_json.exists():
            raise RuntimeError("spec/spec.json missing; run `make spec` first")
        try:
            products = read_products(args.products_url)
        except NETWORK_ERRORS as exc:
            updates.append(warning("spec", f"products.json fetch failed: {exc}"))
        else:
            updates += check_spec(json.loads(spec_json.read_text()), products)

    updates += check_rulesets(manifest, github_fetch, token, only=args.only)

    if args.only in (None, "fatturapa"):
        updates += check_fatturapa(manifest, fetch)

    result = {"checkedAt": utcnow(), "updates": updates}
    payload = json.dumps(result, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(payload)
    else:
        sys.stdout.write(payload)

    if not updates:
        print("all sources up to date", file=sys.stderr)
    for u in updates:
        if u["action"] == "warning":
            print(f"WARNING: {u['source']}: {u['message']}", file=sys.stderr)
        elif u["action"] == "issue":
            print(f"{u['source']}: sha drift ({u['title']})", file=sys.stderr)
        else:
            print(f"{u['source']}: {u['current']} -> {u['latest']} (PR)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, KeyError, FileNotFoundError) as exc:
        print(f"ERROR: update check failed: {exc}", file=sys.stderr)
        sys.exit(1)
