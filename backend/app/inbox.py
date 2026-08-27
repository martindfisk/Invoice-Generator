import base64
import json
from datetime import UTC, datetime
from urllib.parse import quote

from lxml import etree

from app.workflow import UpstreamError

RECEPTION_TYPE = "E_INVOICE::RECEPTION"
FATTURAPA_ROOTS = frozenset({"FatturaElettronica", "FatturaElettronicaSemplificata"})
UBL_ROOTS = frozenset({"Invoice", "CreditNote"})
HUMAN_FIELDS = ("seller_name", "number", "total", "currency")


async def list_inbox(client, system_id, since=None):
    path = f"/records?type={RECEPTION_TYPE}&system_id={quote(system_id, safe='')}"
    response = await client.request("GET", path, step="inbox")
    if response.status_code >= 400:
        raise UpstreamError(response)
    results = response.json().get("results") or []
    items = [_item(result.get("content") or {}) for result in results]
    return sort_inbox(item for item in items if after(item["received_at"], since))


async def get_inbox_item(client, record_id):
    path = f"/records/{quote(record_id, safe='')}?compliance-artifact&operation"
    response = await client.request("GET", path, step="artifact")
    if response.status_code >= 400:
        raise UpstreamError(response)
    content = response.json().get("content") or {}
    artifact = (content.get("compliance") or {}).get("artifact") or {}
    item = _item(content, _decode(artifact.get("data")))
    return _merge(item, _from_operation(content.get("operation")))


def simulate_delivery(store, xml, meta=None):
    meta = meta or {}
    item = {
        "id": str(meta.get("id") or f"simulated-{len(store) + 1}"),
        "source": "simulated",
        "received_at": meta.get("received_at") or datetime.now(UTC).isoformat(timespec="seconds"),
        "xml": xml,
        **read_xml(xml),
    }
    store.insert(0, _merge(item, {key: meta.get(key) for key in HUMAN_FIELDS}))
    return store[0]


def sort_inbox(items):
    return sorted(items, key=lambda item: item["received_at"] or "", reverse=True)


def after(received_at, since):
    if since is None or received_at is None:
        return True
    moment, floor = _moment(received_at), _moment(since)
    if moment is None or floor is None:
        return True
    return moment > floor


def read_xml(xml):
    root = _root(xml)
    if root is None:
        return dict.fromkeys(HUMAN_FIELDS)
    name = etree.QName(root).localname
    if name in FATTURAPA_ROOTS:
        return _fatturapa(root)
    if name in UBL_ROOTS:
        return _ubl(root)
    return dict.fromkeys(HUMAN_FIELDS)


def _item(record, xml=None):
    return {
        "id": record.get("id"),
        "source": "uapi",
        "received_at": (record.get("journal") or {}).get("signed_at"),
        "xml": xml,
        **read_xml(xml),
    }


def _merge(item, extra):
    for key in HUMAN_FIELDS:
        if item.get(key) is None and extra.get(key) is not None:
            item[key] = str(extra[key])
    return item


def _from_operation(operation):
    if isinstance(operation, str):
        try:
            operation = json.loads(operation)
        except ValueError:
            return {}
    if not isinstance(operation, dict):
        return {}
    vat = (operation.get("totals") or {}).get("vat") or {}
    return {
        "seller_name": (operation.get("seller") or {}).get("name"),
        "number": (operation.get("document") or {}).get("number"),
        "total": vat.get("inclusive"),
    }


def _decode(data):
    if not data:
        return None
    return base64.b64decode(data).decode("utf-8")


def _root(xml):
    if not xml:
        return None
    parser = etree.XMLParser(no_network=True, resolve_entities=False)
    try:
        return etree.fromstring(xml.encode("utf-8"), parser)
    except (etree.XMLSyntaxError, ValueError):
        return None


def _text(node, *path):
    steps = "/".join(f"*[local-name()='{name}']" for name in path)
    found = node.xpath(f"./{steps}")
    for element in found:
        if element.text and element.text.strip():
            return element.text.strip()
    return None


def _fatturapa(root):
    header = ("FatturaElettronicaHeader", "CedentePrestatore", "DatiAnagrafici", "Anagrafica")
    document = ("FatturaElettronicaBody", "DatiGenerali", "DatiGeneraliDocumento")
    name = _text(root, *header, "Denominazione")
    if name is None:
        parts = (_text(root, *header, "Nome"), _text(root, *header, "Cognome"))
        name = " ".join(part for part in parts if part) or None
    return {
        "seller_name": name,
        "number": _text(root, *document, "Numero"),
        "total": _text(root, *document, "ImportoTotaleDocumento"),
        "currency": _text(root, *document, "Divisa"),
    }


def _ubl(root):
    party = ("AccountingSupplierParty", "Party")
    name = _text(root, *party, "PartyLegalEntity", "RegistrationName")
    return {
        "seller_name": name or _text(root, *party, "PartyName", "Name"),
        "number": _text(root, "ID"),
        "total": _text(root, "LegalMonetaryTotal", "PayableAmount"),
        "currency": _text(root, "DocumentCurrencyCode"),
    }


def _moment(value):
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)
