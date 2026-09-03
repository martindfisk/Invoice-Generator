import json
import re

from app.spec import load_schemas
from app.validate import OPERATION_SCHEMAS

MAX_DEPTH = 24
PROFILES = ("IT_EI", "BE_EI", "DE_EI")
COUNTRY_PROFILES = {"IT": "IT_EI", "BE": "BE_EI", "DE": "DE_EI"}

CONSTRAINT_KEYWORDS = (
    "pattern",
    "minLength",
    "maxLength",
    "enum",
    "const",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minProperties",
    "maxProperties",
    "format",
    "default",
)

# Keywords the walker itself consumes. Anything outside this set and CONSTRAINT_KEYWORDS is a
# constraint we would silently drop, which is what test_fields.py's version guard catches.
STRUCTURAL_KEYWORDS = frozenset(
    {
        "$ref",
        "allOf",
        "oneOf",
        "anyOf",
        "properties",
        "required",
        "type",
        "items",
        "additionalProperties",
        "discriminator",
        "description",
        "summary",
        "title",
        "example",
        "nullable",
        "deprecated",
    }
)

# Generic base types whose `example` is a shape illustration, not a usable value: inserting
# 'text example...' or the invalid E.164 number '+11 222 3333333' into a payload would be worse
# than inserting nothing. A deny-list, so a newly added well-named type surfaces automatically.
PLACEHOLDER_SCHEMAS = frozenset(
    {
        "PlainString32",
        "PlainString64",
        "PlainString128",
        "PlainString256",
        "PlainString1024",
        "AlphaNumerical20",
        "AlphaNumerical28",
        "AlphaNumerical32",
        "Numerical8",
        "Numerical12",
        "Numerical13",
        "Numerical14",
        "Decimal12p8",
        "UnsignedDecimal3p2",
        "UnsignedInteger4",
        "DateFormatISO8601",
        "DatetimeFormatRFC3339",
        "PhoneNumberFormatE164",
    }
)

FLAGS = re.compile(r"[\U0001f1e6-\U0001f1ff]+")
BLOCK = re.compile(r"\*\*([^*]+?):\*\*")
PROFILE_CODE = re.compile(r"\(([A-Z]{2}_(?:EI|S))\)")
BUSINESS_TERM = re.compile(r"\b(B[TG]-\d+(?:-\d+)?)\b")


def _collapse(text):
    return " ".join(FLAGS.sub("", text.replace("<br>", " ")).split()).strip()


def _status(note):
    lowered = note.lower()
    for prefix, status in (
        ("not required", "not_required"),
        ("not applicable", "not_applicable"),
        ("not supported", "not_supported"),
    ):
        if lowered.startswith(prefix):
            return status
    return "applicable"


def _applicability(raw):
    """Parse the per-profile annotation blocks fiskaly writes into schema descriptions.

    `🇮🇹 **Italy (IT_EI):** (BT-49 …)` / `🇩🇪 **Germany (DE_EI):** Not required`. Only the
    all-products spec carries these; the per-country specs have their descriptions pre-resolved.
    """
    if not raw:
        return {}, None
    blocks = list(BLOCK.finditer(raw))
    if not blocks:
        return {}, _collapse(raw) or None
    lead = _collapse(raw[: blocks[0].start()]) or None
    found = {}
    for index, block in enumerate(blocks):
        end = blocks[index + 1].start() if index + 1 < len(blocks) else len(raw)
        note = _collapse(raw[block.end() : end])
        status = _status(note)
        for code in PROFILE_CODE.findall(block.group(1)):
            if code in PROFILES:
                found[code] = {"status": status, "note": note or None}
    return found, lead


def _merge(schemas, node):
    """Flatten a description-wrapper chain into one schema.

    205 schemas in the invoice closure are `{description: <annotated prose>, allOf: [$ref X]}` or
    the single-branch `oneOf` equivalent: the prose sits on the wrapper and the constraints on the
    target. Breadth-first with `setdefault` means the outermost description wins while the
    innermost constraints survive.
    """
    merged, leaf, example_source = {}, None, None
    queue = [(node, None)]
    while queue:
        current, owner = queue.pop(0)
        for key, value in current.items():
            if key == "$ref":
                target = value.rsplit("/", 1)[1]
                leaf = target
                queue.append((schemas[target], target))
            elif key == "allOf":
                queue.extend((branch, owner) for branch in value)
            elif key == "oneOf" and len(value) == 1:
                queue.extend((branch, owner) for branch in value)
            elif key == "example":
                if "example" not in merged:
                    merged["example"] = value
                    example_source = owner
            else:
                merged.setdefault(key, value)
    return merged, leaf, example_source


def _tag(schemas, branch, property_name):
    merged, _, _ = _merge(schemas, branch)
    properties = merged.get("properties") or {}
    for candidate in [property_name] if property_name else list(properties):
        if candidate not in properties:
            continue
        sub, _, _ = _merge(schemas, properties[candidate])
        enum = sub.get("enum")
        if enum and len(enum) == 1:
            return enum[0]
    return None


def _row(pointer, kind, merged, leaf, example_source, required, optional_ancestor, variants):
    constraints = {key: merged[key] for key in CONSTRAINT_KEYWORDS if key in merged}
    if merged.get("additionalProperties") is False:
        constraints["additionalProperties"] = False
    example = merged.get("example")
    if kind == "leaf" and example_source in PLACEHOLDER_SCHEMAS:
        example = None
    raw = merged.get("description") or ""
    applicability, lead = _applicability(raw)
    kinds = merged.get("type")
    return {
        "pointer": pointer,
        "kind": kind,
        "type": kinds if isinstance(kinds, str) else (kinds[0] if kinds else None),
        "schema": leaf,
        "required": required,
        "optional_ancestor": optional_ancestor,
        "constraints": constraints,
        "description": lead,
        "example": example,
        "example_source": example_source,
        "bt": sorted(set(BUSINESS_TERM.findall(raw))),
        "applicability": applicability,
        "variants": {key: list(value) for key, value in variants.items()},
    }


def _walk(schemas, node, pointer, required, optional_ancestor, variants, depth, rows, unions):
    assert depth < MAX_DEPTH, f"schema nesting exceeded {MAX_DEPTH} at {pointer!r}"
    merged, leaf, example_source = _merge(schemas, node)
    branches = merged.get("oneOf") or merged.get("anyOf")
    if branches and len(branches) > 1:
        property_name = (merged.get("discriminator") or {}).get("propertyName")
        values = [
            _tag(schemas, branch, property_name) or f"#{index}"
            for index, branch in enumerate(branches)
        ]
        unions.append({"pointer": pointer, "property_name": property_name, "values": values})
        for value, branch in zip(values, branches, strict=True):
            _walk(
                schemas,
                branch,
                pointer,
                required,
                optional_ancestor,
                {**variants, pointer: [value]},
                depth + 1,
                rows,
                unions,
            )
        return

    # A node that is optional becomes the nearest optional ancestor for everything beneath it,
    # so a consumer never reports a field inside an absent object as a missing requirement.
    inherited = optional_ancestor if required else pointer

    def emit(kind):
        if pointer:
            rows.append(
                _row(
                    pointer,
                    kind,
                    merged,
                    leaf,
                    example_source,
                    required,
                    optional_ancestor,
                    variants,
                )
            )

    if merged.get("type") == "array" or "items" in merged:
        emit("group")
        _walk(
            schemas,
            merged.get("items", {}),
            f"{pointer}/{{i}}",
            True,
            inherited,
            variants,
            depth + 1,
            rows,
            unions,
        )
        return

    properties = merged.get("properties")
    additional = merged.get("additionalProperties")
    if not properties and isinstance(additional, dict):
        emit("map")
        return
    if properties:
        emit("group")
        declared = set(merged.get("required") or ())
        for name, sub in properties.items():
            _walk(
                schemas,
                sub,
                f"{pointer}/{name}",
                name in declared,
                inherited,
                variants,
                depth + 1,
                rows,
                unions,
            )
        return
    emit("leaf")


def _identity(row):
    return json.dumps({k: v for k, v in row.items() if k != "variants"}, sort_keys=True)


def _combine(left, right):
    if set(left) != set(right):
        return None
    differing = [key for key in left if left[key] != right[key]]
    if len(differing) != 1:
        return None
    key = differing[0]
    return {**left, key: sorted(set(left[key]) | set(right[key]))}


def _compact(rows):
    """Merge rows that differ on exactly one union axis, unioning that axis' values.

    Exact rather than lossy: two otherwise-identical rows can only exist because every branch
    combination was walked, so `{A:[x], B:[p]}` + `{A:[y], B:[p]}` is faithfully `{A:[x,y], B:[p]}`.
    """
    while True:
        buckets = {}
        for row in rows:
            buckets.setdefault(_identity(row), []).append(row)
        compacted = []
        for group in buckets.values():
            result = list(group)
            index = 0
            while index < len(result):
                for other in range(index + 1, len(result)):
                    combined = _combine(result[index]["variants"], result[other]["variants"])
                    if combined is not None:
                        result[index] = {**result[index], "variants": combined}
                        del result[other]
                        break
                else:
                    index += 1
            compacted.extend(result)
        if len(compacted) == len(rows):
            return compacted
        rows = compacted


def extract(schemas, operation):
    root = OPERATION_SCHEMAS[operation]
    rows, unions = [], []
    _walk(
        schemas,
        {"$ref": f"#/components/schemas/{root}"},
        "",
        True,
        None,
        {},
        0,
        rows,
        unions,
    )
    rows = _compact(rows)
    rows.sort(key=lambda row: (row["pointer"], row["kind"]))
    seen, deduped = set(), []
    for union in unions:
        key = (union["pointer"], tuple(union["values"]))
        if key not in seen:
            seen.add(key)
            deduped.append(union)
    deduped.sort(key=lambda union: union["pointer"])
    return rows, deduped


# The walk itself does not depend on the country — only the profile applied afterwards does —
# so one extraction per (spec content, operation) serves every country's request.
_EXTRACT_CACHE_MAX = 8
_extract_cache = {}


def _extract_cached(schemas, digest, operation):
    key = (digest, operation)
    if key not in _extract_cache:
        if len(_extract_cache) >= _EXTRACT_CACHE_MAX:
            _extract_cache.clear()
        _extract_cache[key] = extract(schemas, operation)
    return _extract_cache[key]


def field_metadata(spec_dir, country, operation):
    schemas, digest, source = load_schemas(spec_dir, country)
    shared_rows, unions = _extract_cached(schemas, digest, operation)
    # The per-country verdict is written onto the rows, so the shared extraction stays pristine.
    rows = [dict(row) for row in shared_rows]
    profile = COUNTRY_PROFILES.get(country.upper())
    annotated = any(row["applicability"] for row in rows)
    warnings = []
    if profile and not annotated:
        warnings.append(
            f"{source} carries no per-country annotations, so applicability for {profile} is "
            "unknown rather than inherited; drop the all-products spec into spec/drop/ to get it"
        )
    for row in rows:
        verdict = row["applicability"].get(profile) if profile else None
        row["applicable"] = verdict is None or verdict["status"] == "applicable"
    return {
        "source": source,
        "source_sha256": digest,
        "country": country.upper(),
        "operation": operation,
        "profile": profile,
        "fields": rows,
        "unions": unions,
        "warnings": warnings,
    }
