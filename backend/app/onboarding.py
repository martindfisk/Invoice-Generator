import asyncio

import httpx

from app.settings import COUNTRIES
from app.workflow import UpstreamError

LIST_LIMIT = 100
MAX_LIST_PAGES = 10
OPERATIVE_SYSTEM = ("COMMISSIONED", "OPERATIVE")
DEGRADED_SYSTEM = ("COMMISSIONED", "DEGRADED")
PEPPOL_BLOCKER = "peppol-proof-of-ownership"
SOFTWARE = {"name": "Invoice Generator", "version": "0.1.0"}
REGISTRATIONS = {"IT": [{"type": "SDI"}], "BE": [{"type": "PEPPOL"}], "DE": [{"type": "PEPPOL"}]}
SECRET_FIELDS = {
    "IT": (
        "fiscalization.credentials.pin",
        "fiscalization.credentials.password",
        "fiscalization.credentials.tax_id_number",
    ),
}
TAXPAYER_TEMPLATES = {
    "IT": {
        "type": "COMPANY",
        "name": {"legal": "Azienda Dimostrativa S.r.l.", "trade": "Azienda Dimostrativa"},
        "address": {
            "line": {"type": "STREET_NUMBER", "street": "Via Milano", "number": "42"},
            "code": "20121",
            "city": "Milano",
            "country": "IT",
            "region": "MI",
        },
        "fiscalization": {
            "type": "IT",
            "tax_id_number": "99999999990",
            "vat_id_number": "99999999990",
            "credentials": {"type": "FISCONLINE"},
            "registration": {
                "company_id": "MI12345678901234567",
                "office": "MI",
                "entry": "1234567",
                "legal_form": "LIMITED_LIABILITY_COMPANY",
                "capital": "10000.00",
                "shareholder_status": "SOLE_SHAREHOLDER",
                "liquidation_status": "NOT_IN_LIQUIDATION",
                "tax_regime": "ORDINARY",
            },
        },
    },
    "BE": {
        "type": "COMPANY",
        "name": {"legal": "Voorbeeld Handel BV", "trade": "Voorbeeld Handel"},
        "address": {
            "line": {"type": "STREET_NUMBER", "street": "Rue De L'Exposition", "number": "24"},
            "code": "1000",
            "city": "Brussels",
            "country": "BE",
        },
        "fiscalization": {
            "type": "BE",
            "tax_id_number": "1234567890",
            "vat_id_number": "1403019261",
            "credentials": {"type": "MYMINFIN"},
        },
    },
    "DE": {
        "type": "COMPANY",
        "name": {"legal": "Musterfirma GmbH", "trade": "Musterfirma"},
        "address": {
            "line": {"type": "STREET_NUMBER", "street": "Bundesstrasse", "number": "123"},
            "code": "10178",
            "city": "Berlin",
            "country": "DE",
        },
        "fiscalization": {
            "type": "DE",
            "tax_id_number": "99999999999",
            "vat_id_number": "123456789",
        },
    },
}


class MissingTaxpayerFields(Exception):
    def __init__(self, country, fields):
        self.country = country
        self.fields = fields
        super().__init__(
            f"cannot provision {country}: {', '.join(fields)} must come from the caller — "
            f"they are personal tax-authority credentials and are never defaulted"
        )


class TaxpayerExists(Exception):
    def __init__(self, country, taxpayer_id):
        self.country = country
        self.taxpayer_id = taxpayer_id
        super().__init__(
            f"a {country} taxpayer already exists ({taxpayer_id}); pass reuse=true to adopt it "
            f"instead of creating a duplicate"
        )


def build_taxpayer(country, overrides):
    content = _merge(TAXPAYER_TEMPLATES[country], overrides or {})
    missing = [path for path in SECRET_FIELDS.get(country, ()) if _lookup(content, path) is None]
    if missing:
        raise MissingTaxpayerFields(country, missing)
    return content


async def onboarding_status(client, store):
    persona = client.name
    payload = {
        "persona": persona,
        "environment": store.environment,
        "credentials": store.credential_state(persona),
        "counts": {name: 0 for name in ("organizations", "subjects", "taxpayers", "systems")},
        "organizations": [],
        "subjects": [],
        "taxpayers": [],
        "systems": [],
        "ready": dict.fromkeys(COUNTRIES, False),
        "missing": ["no API credentials configured"],
    }
    if client.mode == "live" and client.persona.missing_credentials:
        return payload
    org_rows, subject_rows, taxpayer_rows, system_rows = await asyncio.gather(
        _list(client, "/organizations"),
        _list(client, "/subjects"),
        _list(client, "/taxpayers"),
        _list(client, "/systems"),
    )
    organizations = [_entity_entry(content) for content in org_rows]
    subjects = [_entity_entry(content) for content in subject_rows]
    taxpayers = [_taxpayer_entry(content) for content in taxpayer_rows]
    systems = [_system_entry(content) for content in system_rows]
    counts = {
        "organizations": len(organizations),
        "subjects": len(subjects),
        "taxpayers": len(taxpayers),
        "systems": len(systems),
    }
    ready, missing = _readiness(taxpayers, systems)
    payload.update(
        counts=counts,
        organizations=organizations,
        subjects=subjects,
        taxpayers=taxpayers,
        systems=systems,
        ready=ready,
        missing=missing,
    )
    return payload


async def provision(client, store, country, taxpayer_content, reuse=True):
    chain = _Chain(client)
    existing = _match_taxpayer(await _list(client, "/taxpayers"), country)
    if existing is not None and not reuse:
        raise TaxpayerExists(country, existing["id"])
    taxpayer = existing
    if taxpayer is None:
        taxpayer = await chain.call(
            "create taxpayer", "POST", "/taxpayers", {"content": taxpayer_content}
        )
    else:
        chain.skip("create taxpayer", "POST", "/taxpayers", taxpayer["id"])
    taxpayer_id = taxpayer.get("id") if taxpayer else None
    taxpayer_path = f"/taxpayers/{taxpayer_id or '{taxpayer_id}'}"
    if taxpayer and taxpayer.get("state") == "COMMISSIONED":
        chain.skip("commission taxpayer", "PATCH", taxpayer_path, taxpayer_id)
        commissioned = True
    else:
        patched = await chain.call(
            "commission taxpayer", "PATCH", taxpayer_path, {"content": {"state": "COMMISSIONED"}}
        )
        commissioned = bool(patched) and patched.get("state") == "COMMISSIONED"
    system = None
    if existing is not None and not chain.failed:
        systems = await _list(client, f"/systems?taxpayer_id={taxpayer_id}")
        system = _match_system(systems)
    if system is None:
        body = {
            "content": {
                "type": "E_INVOICE_SERVICE",
                "location": {"id": taxpayer_id},
                "software": SOFTWARE,
                "registrations": REGISTRATIONS[country],
            }
        }
        system = await chain.call("create system", "POST", "/systems", body)
    else:
        chain.skip("create system", "POST", "/systems", system["id"])
    system_id = system.get("id") if system else None
    system_path = f"/systems/{system_id or '{system_id}'}"
    if system and system.get("state") == "COMMISSIONED":
        chain.skip("commission system", "PATCH", system_path, system_id)
    else:
        await chain.call(
            "commission system", "PATCH", system_path, {"content": {"state": "COMMISSIONED"}}
        )
    verified = await chain.call("verify system", "GET", system_path)
    ready = bool(
        commissioned
        and verified
        and (verified.get("state"), verified.get("mode")) == OPERATIVE_SYSTEM
    )
    if taxpayer_id and system_id:
        store.set_systems(
            client.name, {country: {"system_id": system_id, "taxpayer_id": taxpayer_id}}
        )
    return {
        "steps": chain.steps,
        "created": {"taxpayer_id": taxpayer_id, "location_id": None, "system_id": system_id},
        "ready": ready,
    }


class _Chain:
    def __init__(self, client):
        self.client = client
        self.steps = []
        self.failed = False

    async def call(self, name, method, path, body=None):
        if self.failed:
            self.skip(name, method, path)
            return None
        entry = {"name": name, "method": method, "path": path}
        try:
            response = await self.client.request(method, path, json=body, step="onboarding")
        except httpx.HTTPError as exc:
            self.failed = True
            entry.update(status="failed", error={"message": f"{type(exc).__name__}: {exc}"})
            self.steps.append(entry)
            return None
        if response.status_code >= 400:
            self.failed = True
            entry.update(status="failed", error=_error_content(response))
            self.steps.append(entry)
            return None
        content = _content(response)
        entry.update(status="passed", id=content.get("id"))
        self.steps.append(entry)
        return content

    def skip(self, name, method, path, resource_id=None):
        self.steps.append(
            {"name": name, "method": method, "path": path, "status": "skipped", "id": resource_id}
        )


async def _list(client, path):
    # Readiness must see every resource, not the first page — on an account with more than
    # LIST_LIMIT taxpayers or systems a truncated listing reports a system as missing (or lets
    # provision create a duplicate). Follow pagination, capped so a runaway account cannot spin.
    separator = "&" if "?" in path else "?"
    url = f"{path}{separator}limit={LIST_LIMIT}"
    contents = []
    for _ in range(MAX_LIST_PAGES):
        response = await client.request("GET", url, step="onboarding")
        if response.status_code >= 400:
            raise UpstreamError(response)
        body = response.json()
        contents += [result.get("content") or {} for result in body.get("results") or []]
        token = (body.get("pagination") or {}).get("token")
        if not token:
            return contents
        url = f"{path}{separator}limit={LIST_LIMIT}&token={token}"
    return contents


def _entity_entry(content):
    return {
        "id": content.get("id"),
        "type": content.get("type"),
        "state": content.get("state"),
        "name": content.get("name"),
    }


def _taxpayer_entry(content):
    fiscalization = content.get("fiscalization") or {}
    return {
        "id": content.get("id"),
        "state": content.get("state"),
        "country": _taxpayer_country(content),
        "name": (content.get("name") or {}).get("legal"),
        "vat_id": content.get("vat_number") or fiscalization.get("vat_id_number"),
        "fiscalization_type": fiscalization.get("type"),
    }


def _taxpayer_country(content):
    fiscalization_type = (content.get("fiscalization") or {}).get("type")
    if fiscalization_type:
        return fiscalization_type
    country = content.get("country")
    if isinstance(country, str) and len(country) == 2:
        return country.upper()
    return (content.get("address") or {}).get("country")


def _system_entry(content):
    location_id = (content.get("location") or {}).get("id")
    registrations = [
        {"type": registration.get("type")}
        for registration in content.get("registrations") or []
        if isinstance(registration, dict) and registration.get("type")
    ]
    state, mode = content.get("state"), content.get("mode")
    return {
        "id": content.get("id"),
        "type": content.get("type"),
        "state": state,
        "mode": mode,
        "taxpayer_id": location_id,
        "location_id": location_id,
        "compliance_state": (content.get("compliance") or {}).get("state"),
        "peppol_id": (content.get("annotations") or {}).get("peppol_id"),
        "registrations": registrations,
        "blocked_by": _blocked_by(state, mode, registrations),
    }


def _blocked_by(state, mode, registrations):
    if (state, mode) != DEGRADED_SYSTEM:
        return None
    if any(registration["type"] == "PEPPOL" for registration in registrations):
        return PEPPOL_BLOCKER
    return None


def _readiness(taxpayers, systems):
    ready, missing = {}, []
    for country in COUNTRIES:
        owned = [
            taxpayer
            for taxpayer in taxpayers
            if taxpayer["country"] == country and taxpayer["state"] != "DECOMMISSIONED"
        ]
        commissioned = [taxpayer for taxpayer in owned if taxpayer["state"] == "COMMISSIONED"]
        ready[country] = False
        if not owned:
            missing.append(f"{country}: no taxpayer")
            continue
        if not commissioned:
            missing.append(f"{country}: taxpayer not commissioned")
            continue
        ids = {taxpayer["id"] for taxpayer in commissioned}
        bound = [
            system
            for system in systems
            if system["type"] == "E_INVOICE_SERVICE"
            and system["taxpayer_id"] in ids
            and system["state"] != "DECOMMISSIONED"
        ]
        if not bound:
            missing.append(f"{country}: no E_INVOICE_SERVICE system")
            continue
        operative = [
            system for system in bound if (system["state"], system["mode"]) == OPERATIVE_SYSTEM
        ]
        if not operative:
            system = bound[0]
            missing.append(
                f"{country}: system {system['id']} is {system['state']}/{system['mode']}, "
                f"needs COMMISSIONED/OPERATIVE"
            )
            continue
        ready[country] = True
    return ready, missing


def _match_taxpayer(contents, country):
    candidates = [
        content
        for content in contents
        if _taxpayer_country(content) == country and content.get("state") != "DECOMMISSIONED"
    ]
    commissioned = [c for c in candidates if c.get("state") == "COMMISSIONED"]
    return (commissioned or candidates or [None])[0]


def _match_system(contents):
    candidates = [
        content
        for content in contents
        if content.get("type") == "E_INVOICE_SERVICE" and content.get("state") != "DECOMMISSIONED"
    ]
    operative = [c for c in candidates if (c.get("state"), c.get("mode")) == OPERATIVE_SYSTEM]
    return (operative or candidates or [None])[0]


def _merge(base, override):
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        elif value is not None:
            merged[key] = value
    return merged


def _lookup(content, path):
    value = content
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _content(response):
    body = response.json() if response.content else {}
    content = body.get("content") if isinstance(body, dict) else None
    return content if isinstance(content, dict) else {}


def _error_content(response):
    try:
        body = response.json()
    except ValueError:
        return {"status": response.status_code, "message": response.text}
    if isinstance(body, dict) and isinstance(body.get("content"), dict):
        return body["content"]
    return {"status": response.status_code, "message": str(body)}
