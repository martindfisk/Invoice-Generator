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
MANAGED = ("fiskaly.uapi.e-invoice-", "fiskaly_e-invoice_")
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


def latest_versions(products_json):
    found = {}
    for cc, ver in SPEC_RE.findall(products_json):
        if ver > found.get(cc, ""):
            found[cc] = ver
    return found


def check_openapi(text, version, url):
    if not re.search(r"^openapi:\s*['\"]?3\.", text, re.MULTILINE):
        raise ValueError(f"{url} is not an OpenAPI 3 document")
    head = text.split("\npaths:", 1)[0]
    m = re.search(r"^ {2}version:\s*['\"]?(\d{4}-\d{2}-\d{2})", head, re.MULTILINE)
    if not m or m.group(1) != version:
        raise ValueError(
            f"{url}: info.version {m.group(1) if m else None!r} != {version!r}"
        )


def write_sources(sources, version):
    ts = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "# spec/ provenance",
        "",
        f"Fetched {ts} by `tools/fetch_spec.py` from workspace.fiskaly.com (fiskaly public developer docs).",
        f"`X-Api-Version`: `{version}` (the API accepts only this exact value).",
        "",
        "| file | source | sha256 |",
        "|---|---|---|",
    ]
    lines += [f"| {n} | {u} | {h} |" for n, u, h in sources]
    (SPEC_DIR / "SOURCES.md").write_text("\n".join(lines) + "\n")


def refresh(products_url):
    versions = latest_versions(fetch(products_url).decode())
    missing = [cc for cc in COUNTRIES if cc not in versions]
    if missing:
        raise RuntimeError(f"products.json lists no e-invoice spec for {missing}")
    version = max(versions[cc] for cc in COUNTRIES)
    if any(versions[cc] != version for cc in COUNTRIES):
        print(f"WARNING: spec versions differ per country: {versions}", file=sys.stderr)
    sources = []
    for cc in COUNTRIES:
        v = versions[cc]
        files = {
            f"fiskaly.uapi.e-invoice-{cc}.{v}.yaml": SPEC_URL.format(cc=cc, v=v),
            f"fiskaly_e-invoice_{cc}_{v}_postman_collection.json": POSTMAN_URL.format(
                cc=cc, v=v, kind="collection"
            ),
            f"fiskaly_e-invoice_{cc}_{v}_postman_environment.json": POSTMAN_URL.format(
                cc=cc, v=v, kind="environment"
            ),
        }
        for name, url in files.items():
            data = fetch(url)
            if name.endswith(".yaml"):
                check_openapi(data.decode(), v, url)
            else:
                json.loads(data)
            sources.append((name, url, hashlib.sha256(data).hexdigest(), data))
    SPEC_DIR.mkdir(exist_ok=True)
    keep = {name for name, *_ in sources}
    for old in SPEC_DIR.iterdir():
        if old.name.startswith(MANAGED) and old.name not in keep:
            old.unlink()
    for name, _, _, data in sources:
        (SPEC_DIR / name).write_bytes(data)
    (SPEC_DIR / "version.txt").write_text(version + "\n")
    write_sources([(n, u, h) for n, u, h, _ in sources], version)
    print(f"spec/: {len(sources)} files, X-Api-Version {version}")


def main():
    ap = argparse.ArgumentParser(
        description="Fetch the latest public fiskaly UAPI e-invoice specs into spec/"
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="fail instead of falling back to the cached spec/",
    )
    ap.add_argument("--products-url", default=PRODUCTS_URL)
    args = ap.parse_args()
    version_file = SPEC_DIR / "version.txt"
    try:
        refresh(args.products_url)
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
        RuntimeError,
        ValueError,
    ) as e:
        if version_file.exists() and not args.strict:
            print(
                f"WARNING: spec refresh failed ({e}); using cached spec/ {version_file.read_text().strip()}",
                file=sys.stderr,
            )
            return 0
        print(f"ERROR: spec fetch failed and no cache in spec/: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
