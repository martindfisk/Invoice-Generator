import re
import threading
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from lxml import etree

from app.spec import load_schemas

XMLDSIG_URL = "http://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd"
SCHEMAS = {
    "ubl-invoice-2.1": "ubl-2.1/xsd/maindoc/UBL-Invoice-2.1.xsd",
    "ubl-creditnote-2.1": "ubl-2.1/xsd/maindoc/UBL-CreditNote-2.1.xsd",
    "fatturapa-1.2": "fatturapa/*v1.2.*.xsd",
}


class _VendorResolver(etree.Resolver):
    def __init__(self, vendor_dir):
        self.vendor_dir = vendor_dir

    def resolve(self, system_url, public_id, context):
        if system_url == XMLDSIG_URL:
            local = self.vendor_dir / "fatturapa" / "xmldsig-core-schema.xsd"
            return self.resolve_filename(str(local), context)
        return None


class XsdValidator:
    def __init__(self, vendor_dir):
        self.vendor_dir = Path(vendor_dir)
        self._schemas = {}
        # validate() runs in a threadpool (asyncio.to_thread) and an XMLSchema's error_log is
        # instance state — two concurrent validations against the same schema would read each
        # other's findings without this.
        self._lock = threading.Lock()

    def validate(self, schema_key, xml):
        parser = etree.XMLParser(no_network=True, resolve_entities=False)
        try:
            document = etree.fromstring(xml, parser)
        except etree.XMLSyntaxError:
            return {"valid": False, "findings": _findings(parser.error_log)}
        with self._lock:
            schema = self._schema(schema_key)
            return {"valid": schema.validate(document), "findings": _findings(schema.error_log)}

    def _schema(self, schema_key):
        pattern = SCHEMAS[schema_key]
        if schema_key not in self._schemas:
            parser = etree.XMLParser(no_network=True)
            parser.resolvers.add(_VendorResolver(self.vendor_dir))
            self._schemas[schema_key] = etree.XMLSchema(etree.parse(self._locate(pattern), parser))
        return self._schemas[schema_key]

    def _locate(self, pattern):
        matches = sorted(self.vendor_dir.glob(pattern))
        if not matches:
            raise FileNotFoundError(f"{self.vendor_dir / pattern} missing; run: make schemas")
        return str(matches[-1])


def _findings(error_log):
    return [
        {"line": entry.line, "column": entry.column, "message": entry.message, "path": entry.path}
        for entry in error_log
    ]


SCHEMA_PREFIX = "#/components/schemas/"
DEFS_PREFIX = "#/$defs/"
OPERATION_SCHEMAS = {"INVOICE": "InvoiceTransaction", "CORRECTION": "CorrectionTransaction"}

RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# OpenAPI 3.0 asserts `format`, JSON Schema only annotates it, and jsonschema's own checkers for
# these two need optional third-party packages. Two regexes keep the outcome the same on every
# machine; only the formats the InvoiceTransaction graph actually uses are checked.
UAPI_FORMATS = FormatChecker(formats=[])
UAPI_FORMATS.checks("date-time", raises=())(
    lambda value: not isinstance(value, str) or bool(RFC3339.match(value))
)
UAPI_FORMATS.checks("email", raises=())(
    lambda value: not isinstance(value, str) or bool(EMAIL.match(value))
)


def _discriminated(node):
    mapping = node["discriminator"].get("mapping") or {}
    prop = node["discriminator"]["propertyName"]
    branches = [
        {
            "if": {"properties": {prop: {"const": value}}, "required": [prop]},
            "then": {"$ref": target.replace(SCHEMA_PREFIX, DEFS_PREFIX)},
        }
        for value, target in mapping.items()
    ]
    schema = {
        "type": "object",
        "required": [prop],
        "properties": {prop: {"enum": sorted(mapping)}},
        "allOf": branches,
    }
    if "description" in node:
        schema["description"] = node["description"]
    return schema


def _convert(node):
    if isinstance(node, list):
        return [_convert(item) for item in node]
    if not isinstance(node, dict):
        return node
    # `discriminator` is an OpenAPI keyword jsonschema would ignore, leaving every branch of the
    # oneOf to fail and the real error buried in `context`. Rewriting it into if/then reports the
    # error against the branch the payload actually selected, at its own instance path.
    if "discriminator" in node and "oneOf" in node and (node["discriminator"].get("mapping")):
        return _convert(_discriminated(node))
    schema = {}
    for key, value in node.items():
        if key == "example" or key == "discriminator":
            continue
        if key == "$ref" and isinstance(value, str):
            schema[key] = value.replace(SCHEMA_PREFIX, DEFS_PREFIX)
            continue
        if key == "nullable":
            continue
        if key == "oneOf" and len(value) == 1:
            schema["allOf"] = _convert(value)
            continue
        schema[key] = _convert(value)
    # OpenAPI 3.0 has no null type; `nullable: true` widens whatever type the node declares.
    if node.get("nullable") and "type" in schema:
        declared = schema["type"]
        schema["type"] = [*declared, "null"] if isinstance(declared, list) else [declared, "null"]
    return schema


def _reachable(schemas, roots):
    seen = set()
    pending = list(roots)
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        pending.extend(_refs(schemas[name]))
    return seen


def _refs(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str) and value.startswith(SCHEMA_PREFIX):
                yield value[len(SCHEMA_PREFIX) :]
            else:
                yield from _refs(value)
    elif isinstance(node, list):
        for item in node:
            yield from _refs(item)


def _pointer(path):
    return "".join(f"/{str(part).replace('~', '~0').replace('/', '~1')}" for part in path)


def _leaves(error):
    if error.context:
        for child in error.context:
            yield from _leaves(child)
        return
    yield error


class UapiSchemaValidator:
    def __init__(self, spec_dir):
        self.spec_dir = Path(spec_dir)
        self._validators = {}

    def compile(self, country="IT"):
        self._validator(country)

    def validate(self, operation, country="IT"):
        validator = self._validator(country)
        findings = []
        seen = set()
        for error in validator.iter_errors(operation):
            for leaf in _leaves(error):
                finding = {
                    "pointer": _pointer(leaf.absolute_path),
                    "keyword": str(leaf.validator),
                    "message": leaf.message,
                }
                key = tuple(finding.values())
                if key in seen:
                    continue
                seen.add(key)
                findings.append(finding)
        findings.sort(key=lambda item: (item["pointer"], item["keyword"], item["message"]))
        return {"valid": not findings, "findings": findings}

    def schema(self, country="IT"):
        return self._validator(country).schema

    def _validator(self, country):
        # Keyed on the spec's content, not the country: with an all-products spec active every
        # country resolves to the same bytes and shares one compiled validator, and replacing the
        # spec invalidates the memo instead of serving the previous graph.
        schemas, key, name = load_schemas(self.spec_dir, country)
        if key not in self._validators:
            missing = [n for n in OPERATION_SCHEMAS.values() if n not in schemas]
            if missing:
                raise KeyError(f"{', '.join(missing)} missing from {name}; run: make spec")
            names = _reachable(schemas, OPERATION_SCHEMAS.values())
            root = {
                "discriminator": {
                    "propertyName": "type",
                    "mapping": {
                        value: f"{SCHEMA_PREFIX}{name}" for value, name in OPERATION_SCHEMAS.items()
                    },
                },
                "oneOf": [f"{SCHEMA_PREFIX}{name}" for name in OPERATION_SCHEMAS.values()],
            }
            schema = {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "$defs": {name: _convert(schemas[name]) for name in sorted(names)},
                **_convert(root),
            }
            self._validators[key] = Draft202012Validator(schema, format_checker=UAPI_FORMATS)
        return self._validators[key]
