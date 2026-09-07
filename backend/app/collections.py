import json
import re
from pathlib import Path

from app.spec import manifest

COLLECTION_GLOB = "fiskaly_e-invoice_*_postman_collection.json"
PROXY_SKIP = "handled by the proxy"
ACCOUNT_SKIP = "creates or mutates account resources"
RECEPTION_SKIP = "the app has no receive step; a live account has no seeded inbox to list"
READ_ONLY_RESOURCES = frozenset({"taxpayers", "systems"})
RUNNABLE_FOLDER_WORDS = ("transmission",)
SET_PATTERN = re.compile(r"pm\.environment\.set\(\s*[\"']([A-Za-z0-9_]+)[\"']")
DOCS_LINK = re.compile(r"developer\.fiskaly\.com/api/([a-z0-9-]+)/(\d{4}-\d{2}-\d{2})")
TYPE_TEST = re.compile(r"pm\.test\(\s*[\"']Type is ([A-Z_:]+)[\"']")
TYPE_EQL = re.compile(r"to\.eql\(\s*[\"']([A-Z_:]+)[\"']\s*\)")
CURRENT_DOCS_HOST = "workspace.fiskaly.com"
PEPPOL_ASSERT = "annotations.peppol_id"

USED_IN_POINTER = "/content/used_in/id"
MODE_POINTER = "/content/mode"

IT_B2B = "records (B2B E-Invoice Transmission with SDI recipient)"
IT_B2C = "records (B2C E-Invoice Transmission with pec recipient)"
BE_PEPPOL = "records (E-Invoice Transmission with Peppol recipient)"
EMAIL = "records (E-Invoice Transmission with email recipient)"

# Variable names are transcribed verbatim from the published collections' test scripts,
# including the mis-prefixed be* names the DE collection inherited from its Belgian
# original (beEmailTransmissionId, bePeppolCorrectionTransmissionId): parity with a real
# Postman run matters more than tidiness.
CAPTURES = {
    ("it", IT_B2B, "Create INTENTION::TRANSACTION"): (("invoiceIntentionId", "/content/id"),),
    ("it", IT_B2B, "Create TRANSACTION::INVOICE"): (("eInvoiceId", "/content/id"),),
    ("it", IT_B2B, "Retrieve TRANSACTION::INVOICE"): (("transmissionId", USED_IN_POINTER),),
    ("it", IT_B2B, "Create INTENTION::TRANSACTION Correction"): (
        ("eInvoiceCorrectionIntentionId", "/content/id"),
    ),
    ("it", IT_B2B, "Create TRANSACTION::CORRECTION INVOICE"): (
        ("eInvoiceCorrectionId", "/content/id"),
    ),
    ("it", IT_B2B, "Retrieve TRANSACTION::CORRECTION"): (
        ("correctionTransmissionId", USED_IN_POINTER),
    ),
    ("it", IT_B2C, "Create INTENTION::TRANSACTION"): (("invoiceb2cIntentionId", "/content/id"),),
    ("it", IT_B2C, "Create TRANSACTION::INVOICE"): (("b2ceInvoiceId", "/content/id"),),
    ("it", IT_B2C, "Retrieve TRANSACTION::INVOICE"): (("b2ctransmissionId", USED_IN_POINTER),),
    ("be", BE_PEPPOL, "Create INTENTION::TRANSACTION"): (("eInvoiceIntentionId", "/content/id"),),
    ("be", BE_PEPPOL, "Create TRANSACTION::INVOICE"): (("eInvoiceId", "/content/id"),),
    ("be", BE_PEPPOL, "Retrieve TRANSACTION::INVOICE"): (
        ("bePeppolTransmissionId", USED_IN_POINTER),
    ),
    ("be", BE_PEPPOL, "Create INTENTION::TRANSACTION Correction"): (
        ("eInvoiceCorrectionIntentionId", "/content/id"),
    ),
    ("be", BE_PEPPOL, "Create TRANSACTION::CORRECTION INVOICE"): (
        ("eInvoiceCorrectionId", "/content/id"),
    ),
    ("be", BE_PEPPOL, "Retrieve TRANSACTION::CORRECTION"): (
        ("bePeppolCorrectionTransmissionId", USED_IN_POINTER),
    ),
    ("be", EMAIL, "Create INTENTION::TRANSACTION"): (("eEmailInvoiceIntentionId", "/content/id"),),
    ("be", EMAIL, "Create TRANSACTION::INVOICE"): (("eInvoiceId", "/content/id"),),
    ("be", EMAIL, "Retrieve TRANSACTION::INVOICE"): (("beEmailTransmissionId", USED_IN_POINTER),),
    ("be", EMAIL, "Create INTENTION::TRANSACTION Correction"): (
        ("eInvoiceCorrectionIntentionId", "/content/id"),
    ),
    ("be", EMAIL, "Create TRANSACTION::CORRECTION INVOICE"): (
        ("eInvoiceCorrectionId", "/content/id"),
    ),
    ("be", EMAIL, "Retrieve TRANSACTION::CORRECTION"): (
        ("bePeppolCorrectionTransmissionId", USED_IN_POINTER),
    ),
    ("de", EMAIL, "Create INTENTION::TRANSACTION"): (("emailInvoiceIntentionId", "/content/id"),),
    ("de", EMAIL, "Create TRANSACTION::INVOICE"): (("eInvoiceId", "/content/id"),),
    ("de", EMAIL, "Retrieve TRANSACTION::INVOICE"): (("beEmailTransmissionId", USED_IN_POINTER),),
    ("de", EMAIL, "Create INTENTION::TRANSACTION Correction"): (
        ("eInvoiceCorrectionIntentionId", "/content/id"),
    ),
    ("de", EMAIL, "Create TRANSACTION::CORRECTION INVOICE"): (
        ("eInvoiceCorrectionId", "/content/id"),
    ),
    ("de", EMAIL, "Retrieve TRANSACTION::CORRECTION"): (
        ("bePeppolCorrectionTransmissionId", USED_IN_POINTER),
    ),
}

# "Create TRANSACTION::CORRECTION INVOICE" carries a test labelled "Type is
# TRANSACTION::INVOICE" whose script asserts eql("TRANSACTION::CORRECTION") — the actual
# test value is transcribed, not the label.
ASSERTS = {
    "Create INTENTION::TRANSACTION": (("/content/type", "INTENTION::TRANSACTION"),),
    "Create INTENTION::TRANSACTION Correction": (("/content/type", "INTENTION::TRANSACTION"),),
    "Create TRANSACTION::INVOICE": (("/content/type", "TRANSACTION::INVOICE"),),
    "Create TRANSACTION::CORRECTION INVOICE": (("/content/type", "TRANSACTION::CORRECTION"),),
    "Create a System::E_INVOICE_SERVICE": (("/content/type", "E_INVOICE_SERVICE"),),
    "Retrieve a System::E_INVOICE_SERVICE": (("/content/type", "E_INVOICE_SERVICE"),),
    "Retrieve System with Peppol ID": (("/content/annotations/peppol_id", None),),
    "Retrieve the Receipt of Transmission": (("/content/compliance/archive/data", None),),
    "Update a Taxpayer::COMPANY (Commission)": (("/content/state", "COMMISSIONED"),),
    "Commission System": (
        ("/content/state", "COMMISSIONED"),
        ("/content/mode", "OPERATIVE"),
    ),
    "Commission System (without proof of ownership)": (
        ("/content/state", "COMMISSIONED"),
        ("/content/mode", "DEGRADED"),
    ),
    "Commission System (after proof of ownership)": (
        ("/content/state", "COMMISSIONED"),
        ("/content/mode", "OPERATIVE"),
    ),
    "Create INTENTION::UPLOAD (Proof of Ownership)": (
        ("/content/type", "INTENTION::UPLOAD"),
        ("/content/state", "ACCEPTED"),
    ),
    "Check Upload Status": (
        ("/content/state", "COMPLETED"),
        ("/content/mode", "FINISHED"),
    ),
    "Retrieve Proof of Ownership Result": (("/content/type", "UPLOAD::PEPPOL_PROOF_OF_OWNERSHIP"),),
}

# Written notes on semantic defects in the published collections that no cheap check can
# derive from the JSON; anything mechanical is derived in _derived_notes instead.
WRITTEN_NOTES = {
    "de": (
        {
            "severity": "warning",
            "message": (
                'Both invoice bodies charge VAT percentage "22.00" with code STANDARD — '
                "the Italian standard rate on a German invoice; Germany's standard rate "
                "is 19 %. Sent as published."
            ),
        },
        {
            "severity": "info",
            "message": (
                "The chained variables beEmailTransmissionId and "
                "bePeppolCorrectionTransmissionId keep their Belgian names, and the second "
                "holds an email correction transmission, not a Peppol one. Kept verbatim "
                "for parity with a real Postman run."
            ),
        },
        {
            "severity": "warning",
            "message": (
                'recipients[0].identification.number "369204173" is nine digits with no '
                "country prefix and is not a plausible German USt-IdNr. Sent as published."
            ),
        },
    ),
}

# The collections contain no polling and assert terminal state immediately; these waits
# are ours, added so a replay survives fiskaly still processing.
WAITS = {
    "Retrieve TRANSACTION::INVOICE": (USED_IN_POINTER, None),
    "Retrieve TRANSACTION::CORRECTION": (USED_IN_POINTER, None),
    "Retrieve E_INVOICE::TRANSMISSION": (MODE_POINTER, "FINISHED"),
    "Retrieve E_INVOICE::TRANSMISSION Correction": (MODE_POINTER, "FINISHED"),
}


def load_collections(spec_dir, timeout_s):
    recorded = manifest(spec_dir)
    collections = {}
    for file in sorted(Path(spec_dir).glob(COLLECTION_GLOB)):
        collection = parse_collection(file, timeout_s, _identify(file, recorded))
        collections[collection["id"]] = collection
    return collections


def _identify(file, recorded):
    """Country and version from spec.json, so the filename is not load-bearing."""
    for entry in (recorded or {}).get("collections", []):
        if entry["file"] == file.name and entry.get("kind") == "collection":
            return entry["country"], entry["version"]
    parts = file.stem.split("_")
    if len(parts) < 4:
        raise ValueError(
            f"{file.name} is not listed in spec.json and its name does not match "
            "fiskaly_e-invoice_<cc>_<version>_postman_collection.json; run: make spec"
        )
    return parts[2], parts[3]


def parse_collection(file, timeout_s, identity):
    collection_id, version = identity
    document = json.loads(file.read_text())
    steps = []
    for folder, item in _requests(document["item"]):
        steps.append(_step(collection_id, folder, item, len(steps) + 1, timeout_s))
    return {
        "id": collection_id,
        "name": document["info"]["name"],
        "version": version,
        "steps": steps,
        "notes": [
            *WRITTEN_NOTES.get(collection_id, ()),
            *_derived_notes(collection_id, version, document, steps),
        ],
    }


def _derived_notes(collection_id, version, document, steps):
    return [
        *_description_notes(collection_id, version, document),
        *_peppol_notes(document, steps),
        *_label_notes(document),
    ]


def _description_notes(collection_id, version, document):
    notes = []
    for product, linked_version in DOCS_LINK.findall(document["info"].get("description", "")):
        problems = []
        expected = f"e-invoice-{collection_id}"
        if product != expected:
            problems.append(f"the wrong product (this is the {expected} collection)")
        if linked_version != version:
            problems.append(f"the wrong version (the collection itself is {version})")
        problems.append(f"a deprecated host (current documentation lives on {CURRENT_DOCS_HOST})")
        joined = (
            problems[0]
            if len(problems) == 1
            else (", ".join(problems[:-1]) + " and " + problems[-1])
        )
        notes.append(
            {
                "severity": "warning" if product != expected else "info",
                "message": (
                    "info.description links to developer.fiskaly.com/api/"
                    f"{product}/{linked_version} — {joined}."
                ),
            }
        )
    return notes


def _peppol_notes(document, steps):
    scripts = [
        "\n".join(event["script"]["exec"])
        for _, item in _requests(document["item"])
        for event in item.get("event", ())
        if event.get("listen") == "test"
    ]
    asserts_peppol_id = any(PEPPOL_ASSERT in source for source in scripts)
    proof_of_ownership = any(
        "proof of ownership" in item["name"].lower() for _, item in _requests(document["item"])
    )
    sends_peppol = any(_uses_peppol(step["body"]) for step in steps)
    if not (asserts_peppol_id and proof_of_ownership and not sends_peppol):
        return []
    return [
        {
            "severity": "warning",
            "message": (
                "The collection performs the full Peppol proof-of-ownership flow and "
                "asserts annotations.peppol_id, yet never sends an invoice with "
                "invoicing.type PEPPOL — nothing in it uses the capability it proves."
            ),
        }
    ]


def _uses_peppol(value):
    if isinstance(value, dict):
        invoicing = value.get("invoicing")
        if isinstance(invoicing, dict) and invoicing.get("type") == "PEPPOL":
            return True
        return any(_uses_peppol(entry) for entry in value.values())
    if isinstance(value, list):
        return any(_uses_peppol(entry) for entry in value)
    return False


def _label_notes(document):
    notes = []
    seen = set()
    for _, item in _requests(document["item"]):
        for event in item.get("event", ()):
            if event.get("listen") != "test":
                continue
            source = "\n".join(event["script"]["exec"])
            for match in TYPE_TEST.finditer(source):
                labelled = match.group(1)
                asserted = TYPE_EQL.search(source, match.end())
                if not asserted or asserted.group(1) == labelled:
                    continue
                key = (item["name"], labelled, asserted.group(1))
                if key in seen:
                    continue
                seen.add(key)
                notes.append(
                    {
                        "severity": "warning",
                        "message": (
                            f'On "{item["name"]}" a test labelled "Type is {labelled}" '
                            f"actually asserts {asserted.group(1)} — the runner "
                            "transcribes the asserted value, not the label."
                        ),
                    }
                )
    return notes


def _requests(items, folder=""):
    for item in items:
        if "item" in item:
            yield from _requests(item["item"], item["name"])
        else:
            yield folder, item


def _step(collection_id, folder, item, index, timeout_s):
    name = item["name"]
    request = item["request"]
    url = request["url"]
    method = request["method"]
    path = "/" + "/".join(url.get("path", []))
    runnable, skip_reason = _scope(folder, method, path)
    captures = CAPTURES.get((collection_id, folder, name), ())
    if runnable:
        unmapped = _unmapped(item, {variable for variable, _ in captures})
        if unmapped:
            runnable = False
            skip_reason = f"no capture rule for variable {unmapped[0]!r}"
    wait = WAITS.get(name) if runnable else None
    return {
        "id": f"{collection_id}-{index:02d}-{_slug(name)}",
        "name": name,
        "folder": folder,
        "method": method,
        "path": path,
        "query": {entry["key"]: entry.get("value") for entry in url.get("query", [])},
        "body": _body(request),
        "runnable": runnable,
        "skipReason": skip_reason,
        "captures": [{"variable": variable, "pointer": pointer} for variable, pointer in captures],
        "waitFor": (
            {"pointer": wait[0], "equals": wait[1], "timeoutS": timeout_s} if wait else None
        ),
        "asserts": [
            {"pointer": pointer, "equals": equals} for pointer, equals in ASSERTS.get(name, ())
        ],
    }


def _scope(folder, method, path):
    resource = path.strip("/").split("/")[0]
    if resource == "tokens":
        return False, PROXY_SKIP
    lowered = folder.lower()
    if lowered.startswith("records") and "reception" in lowered:
        return False, RECEPTION_SKIP
    if lowered.startswith("records") and any(word in lowered for word in RUNNABLE_FOLDER_WORDS):
        return True, None
    if method == "GET" and resource in READ_ONLY_RESOURCES:
        return True, None
    return False, ACCOUNT_SKIP


def _unmapped(item, known):
    unmapped = []
    for event in item.get("event", ()):
        if event.get("listen") != "test":
            continue
        source = "\n".join(event["script"]["exec"])
        unmapped += [name for name in SET_PATTERN.findall(source) if name not in known]
    return unmapped


def _body(request):
    raw = (request.get("body") or {}).get("raw")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
