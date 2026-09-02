import hashlib
import json
from pathlib import Path

import yaml

MANIFEST = "spec.json"
FALLBACK_PATTERN = "fiskaly.uapi.e-invoice-{country}.*.yaml"
_CACHE = {}
_CACHE_MAX = 8


def manifest(spec_dir):
    path = Path(spec_dir) / MANIFEST
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path} is not valid JSON ({exc}); run: make spec") from exc


def active_spec(spec_dir, country="IT"):
    """The spec a country validates against.

    A spec ingested from spec/drop/ is the authority for every country. Without one, each country
    falls back to its own spec fetched from workspace.fiskaly.com.
    """
    spec_dir = Path(spec_dir)
    recorded = manifest(spec_dir)
    if recorded:
        dropped = recorded.get("spec")
        if dropped and (spec_dir / dropped["file"]).exists():
            return spec_dir / dropped["file"]
        for entry in recorded.get("fallback", []):
            if entry["country"] == country.lower() and (spec_dir / entry["file"]).exists():
                return spec_dir / entry["file"]
    matches = sorted(spec_dir.glob(FALLBACK_PATTERN.format(country=country.lower())))
    if matches:
        return matches[-1]
    raise FileNotFoundError(f"no spec for {country} in {spec_dir}; run: make spec")


def load_schemas(spec_dir, country="IT"):
    """`(components.schemas, sha256, filename)` for the active spec, parsed at most once."""
    path = active_spec(spec_dir, country)
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    cached = _CACHE.get(key)
    if cached is None:
        data = path.read_bytes()
        document = yaml.safe_load(data)
        try:
            schemas = document["components"]["schemas"]
        except (KeyError, TypeError) as exc:
            raise KeyError(f"{path.name} has no components.schemas; run: make spec") from exc
        cached = (schemas, hashlib.sha256(data).hexdigest(), path.name)
        if len(_CACHE) >= _CACHE_MAX:
            _CACHE.clear()
        _CACHE[key] = cached
    return cached
