#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC_DIR = ROOT / "spec"
DROP_DIR = SPEC_DIR / "drop"
MANIFEST = SPEC_DIR / "spec.json"
PRODUCTS_URL = "https://workspace.fiskaly.com/products.json"
COUNTRIES = ("it", "be", "de")
SPEC_URL = "https://workspace.fiskaly.com/specs/fiskaly.uapi.e-invoice-{cc}.{v}.yaml"
POSTMAN_URL = (
    "https://workspace.fiskaly.com/static/postman/UAPI_{v}/"
    "fiskaly_e-invoice_{cc}_{v}_postman_{kind}.json"
)
SPEC_RE = re.compile(
    r"https://workspace\.fiskaly\.com/specs/fiskaly\.uapi\.e-invoice-(it|be|de)\.(\d{4}-\d{2}-\d{2})\.yaml"
)
DROP_NAME = "fiskaly.unified-api.all.{v}.yaml"
DROP_TITLE = "Unified API"
DROP_SOURCE = (
    "hand-dropped into spec/drop/ (not published on workspace.fiskaly.com — verified 404)"
)
CA_BUNDLES = (
    "/etc/ssl/cert.pem",
    "/etc/ssl/certs/ca-certificates.crt",
    "/opt/homebrew/etc/openssl@3/cert.pem",
    "/opt/homebrew/etc/ca-certificates/cert.pem",
)


def ssl_context():
    ctx = ssl.create_default_context()
    if ctx.cert_store_stats()["x509_ca"]:
        return ctx
    try:
        import certifi

        ctx.load_verify_locations(certifi.where())
        return ctx
    except ImportError:
        pass
    for path in CA_BUNDLES:
        if Path(path).exists():
            ctx.load_verify_locations(path)
            return ctx
    raise RuntimeError(
        "no CA bundle found; run 'Install Certificates.command' or pip install certifi"
    )


CTX = None


def fetch(url, timeout=30):
    global CTX
    if CTX is None:
        CTX = ssl_context()
    req = urllib.request.Request(
        url, headers={"User-Agent": "invoice-generator/fetch_spec"}
    )
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


def utcnow():
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def latest_versions(products_json):
    found = {}
    for cc, ver in SPEC_RE.findall(products_json):
        if ver > found.get(cc, ""):
            found[cc] = ver
    return found


def read_info(text, origin):
    """Discovery by content: pull info.version and info.title out of the document head.

    Deliberately regex, not a YAML parse: tools/ is stdlib-only because `make spec` runs
    before the backend venv (and therefore pyyaml) exists.
    """
    if not re.search(r"^openapi:\s*['\"]?3\.", text, re.MULTILINE):
        raise ValueError(f"{origin} is not an OpenAPI 3 document")
    head = text.split("\npaths:", 1)[0]
    version = re.search(r"^ {2}version:\s*['\"]?(\d{4}-\d{2}-\d{2})", head, re.MULTILINE)
    title = re.search(r"^ {2}title:\s*['\"]?([^'\"\n]+)", head, re.MULTILINE)
    if not version:
        raise ValueError(f"{origin}: no CalVer info.version in the document head")
    return version.group(1), (title.group(1).strip() if title else "")


def ingest_drop():
    """Move a hand-dropped spec into spec/. An empty spec/drop/ is the 'consumed' signal."""
    if not DROP_DIR.is_dir():
        return None
    dropped = sorted(p for p in DROP_DIR.iterdir() if p.suffix in (".yaml", ".yml"))
    if not dropped:
        return None
    if len(dropped) > 1:
        names = ", ".join(p.name for p in dropped)
        raise RuntimeError(
            f"spec/drop/ holds {len(dropped)} specs ({names}); keep exactly one and re-run"
        )
    src = dropped[0]
    data = src.read_bytes()
    version, title = read_info(data.decode(), src.name)
    if DROP_TITLE not in title:
        raise RuntimeError(
            f"{src.name}: info.title {title!r} does not contain {DROP_TITLE!r}; "
            "spec/drop/ is for the all-products Unified API spec, not a per-country one"
        )
    name = DROP_NAME.format(v=version)
    src.replace(SPEC_DIR / name)
    return {
        "file": name,
        "title": title,
        "version": version,
        "sha256": sha256(data),
        "bytes": len(data),
        "origin": f"drop:{src.name}",
        "ingestedAt": utcnow(),
    }


def carry_forward_spec(previous):
    entry = (previous or {}).get("spec")
    if not entry:
        return None
    path = SPEC_DIR / entry["file"]
    if not path.exists():
        return None
    if sha256(path.read_bytes()) != entry["sha256"]:
        raise RuntimeError(
            f"{entry['file']} changed on disk since it was ingested; re-drop it into "
            "spec/drop/ (or delete spec/spec.json) so the new bytes are recorded"
        )
    return entry


def refresh_fetched(products_url):
    versions = latest_versions(fetch(products_url).decode())
    missing = [cc for cc in COUNTRIES if cc not in versions]
    if missing:
        raise RuntimeError(f"products.json lists no e-invoice spec for {missing}")
    fallback, collections, blobs = [], [], {}
    for cc in COUNTRIES:
        v = versions[cc]
        url = SPEC_URL.format(cc=cc, v=v)
        name = f"fiskaly.uapi.e-invoice-{cc}.{v}.yaml"
        data = fetch(url)
        got, title = read_info(data.decode(), url)
        if got != v:
            raise ValueError(f"{url}: info.version {got!r} != {v!r}")
        blobs[name] = data
        fallback.append(
            {
                "file": name,
                "country": cc,
                "version": v,
                "title": title,
                "sha256": sha256(data),
                "source": url,
            }
        )
        for kind in ("collection", "environment"):
            url = POSTMAN_URL.format(cc=cc, v=v, kind=kind)
            data = fetch(url)
            json.loads(data)
            name = f"fiskaly_e-invoice_{cc}_{v}_postman_{kind}.json"
            blobs[name] = data
            collections.append(
                {
                    "file": name,
                    "country": cc,
                    "version": v,
                    "kind": kind,
                    "sha256": sha256(data),
                    "source": url,
                }
            )
    return fallback, collections, blobs


def managed_files(manifest):
    if not manifest:
        return set()
    names = {e["file"] for e in manifest.get("fallback", [])}
    names |= {e["file"] for e in manifest.get("collections", [])}
    if manifest.get("spec"):
        names.add(manifest["spec"]["file"])
    return names


def rows(manifest):
    out = []
    if manifest.get("spec"):
        s = manifest["spec"]
        out.append((s["file"], DROP_SOURCE, s["sha256"]))
    for entry in manifest.get("fallback", []) + manifest.get("collections", []):
        out.append((entry["file"], entry["source"], entry["sha256"]))
    return out


def write_sources(manifest):
    active = manifest["spec"]["file"] if manifest.get("spec") else "the per-country specs below"
    lines = [
        "# spec/ provenance",
        "",
        f"Written {manifest['generatedAt']} by `tools/fetch_spec.py`.",
        f"`X-Api-Version`: `{manifest['apiVersion']}` (the API accepts only this exact value).",
        "",
        f"Active spec: **{active}**. A spec placed in `spec/drop/` takes precedence over the",
        "per-country specs fetched from workspace.fiskaly.com; `spec/spec.json` records which.",
        "",
        "| file | source | sha256 |",
        "|---|---|---|",
    ]
    lines += [f"| {n} | {s} | {h} |" for n, s, h in rows(manifest)]
    (SPEC_DIR / "SOURCES.md").write_text("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(
        description="Ingest a dropped OpenAPI spec and fetch the public fiskaly UAPI specs into spec/"
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="fail instead of falling back to the cached spec/",
    )
    ap.add_argument("--products-url", default=PRODUCTS_URL)
    args = ap.parse_args()
    SPEC_DIR.mkdir(exist_ok=True)
    DROP_DIR.mkdir(exist_ok=True)
    previous = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else None

    try:
        spec = ingest_drop() or carry_forward_spec(previous)
    except (RuntimeError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    try:
        fallback, collections, blobs = refresh_fetched(args.products_url)
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
        RuntimeError,
        ValueError,
    ) as e:
        cached = (previous or {}).get("fallback") or (previous or {}).get("collections")
        if not cached or args.strict:
            print(f"ERROR: spec fetch failed and no usable cache in spec/: {e}", file=sys.stderr)
            return 1
        fallback = previous.get("fallback", [])
        collections = previous.get("collections", [])
        blobs = {}
        absent = [
            e2["file"]
            for e2 in fallback + collections
            if not (SPEC_DIR / e2["file"]).exists()
        ]
        if absent:
            print(f"ERROR: spec fetch failed and cached spec/ is incomplete: {absent}", file=sys.stderr)
            return 1
        print(f"WARNING: spec refresh failed ({e}); using cached spec/", file=sys.stderr)

    if spec is None and not fallback:
        print(
            "ERROR: no spec available; drop one into spec/drop/ or restore network access",
            file=sys.stderr,
        )
        return 1

    api_version = spec["version"] if spec else max(e["version"] for e in fallback)
    manifest = {
        "generatedAt": utcnow(),
        "apiVersion": api_version,
        "spec": spec,
        "fallback": fallback,
        "collections": collections,
    }

    for name, data in blobs.items():
        (SPEC_DIR / name).write_bytes(data)
    keep = managed_files(manifest)
    for stale in managed_files(previous) - keep:
        (SPEC_DIR / stale).unlink(missing_ok=True)

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    (SPEC_DIR / "version.txt").write_text(api_version + "\n")
    write_sources(manifest)

    if spec:
        print(f"spec/: active {spec['file']} ({spec['origin']})")
    else:
        print("spec/: active per-country specs (nothing dropped)")
    print(
        f"spec/: {len(fallback)} per-country, {len(collections)} collection files, "
        f"X-Api-Version {api_version}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
