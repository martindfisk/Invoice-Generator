import asyncio
import json

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.collections import load_collections
from app.fields import field_metadata
from app.mock import MockTransport
from app.models import (
    Artifact,
    Collection,
    CollectionSummary,
    Config,
    CorrectionCreated,
    CorrectionRequest,
    CredentialState,
    Health,
    InvoiceCreated,
    InvoiceRequest,
    ModeState,
    ModeUpdate,
    OnboardingStatus,
    PersonaState,
    ProvisionRequest,
    ProvisionResult,
    RecipientState,
    RecordListing,
    SettingsState,
    SettingsUpdate,
    SpecFields,
    SystemState,
    TransmissionWait,
    UapiSchemaRequest,
    UapiSchemaResult,
    XsdRequest,
    XsdResult,
)
from app.onboarding import (
    MissingTaxpayerFields,
    TaxpayerExists,
    build_taxpayer,
    onboarding_status,
    provision,
)
from app.recorder import CallRecord
from app.session import BASE_URLS
from app.settings import COUNTRIES, PERSONAS
from app.spec import load_schemas, manifest
from app.validate import OPERATION_SCHEMAS, SCHEMAS
from app.workflow import (
    ARTIFACT_KINDS,
    INVOICE_TYPE,
    artifact_kind,
    create_correction,
    create_invoice,
    fetch_artifact,
    fetch_files,
    list_records,
    wait_for_transmission,
)

router = APIRouter(prefix="/api")
UPSTREAM_HEADERS = ("X-Trace-Identifier", "X-Api-Version", "X-Idempotency-Replayed")
CREDENTIAL_TARGETS = (*PERSONAS, "all")


def current_mode(app):
    return app.state.clients["seller"].mode


@router.get("/health", response_model=Health)
async def health(request: Request):
    return Health(
        status="ok",
        mode=current_mode(request.app),
        api_version=request.app.state.store.api_version,
    )


@router.get("/config", response_model=Config)
async def config(request: Request):
    store = request.app.state.store
    personas = {}
    for name in PERSONAS:
        systems = store.persona(name).systems
        personas[name] = {country: system for country, system in systems.items() if system}
    recorded = manifest(store.settings.spec_dir) or {}
    active = recorded.get("spec") or {}
    return Config(
        mode=current_mode(request.app),
        environment=store.environment,
        api_version=store.api_version,
        personas=personas,
        spec_source=active.get("file") or _fallback_source(recorded),
        spec_sha256=active.get("sha256"),
        spec_origin=active.get("origin") or ("fetched" if recorded else None),
        spec_ingested_at=active.get("ingestedAt") or recorded.get("generatedAt"),
    )


def _fallback_source(recorded):
    for entry in recorded.get("fallback", []):
        if entry["country"] == "it":
            return entry["file"]
    return None


def settings_state(app):
    store = app.state.store
    personas = {}
    for name in PERSONAS:
        systems = store.persona(name).systems
        personas[name] = PersonaState(
            credentials=CredentialState(**store.credential_state(name)),
            systems={country: SystemState(**(system or {})) for country, system in systems.items()},
            recipients=RecipientState(**store.recipients(name)),
        )
    return SettingsState(
        mode=current_mode(app),
        environment=store.environment,
        base_url=store.base_url,
        api_version=store.api_version,
        personas=personas,
    )


def persona_updates(personas):
    updates = {}
    for name, update in (personas or {}).items():
        if name not in PERSONAS:
            raise HTTPException(400, f"unknown persona {name!r}; expected one of {PERSONAS}")
        api_key = (update.api_key or "").strip() or None
        api_secret = (update.api_secret or "").strip() or None
        if bool(api_key) != bool(api_secret):
            raise HTTPException(
                400,
                f"persona {name!r}: api_key and api_secret must be set together",
            )
        systems = {}
        for country, system in (update.systems or {}).items():
            if country.upper() not in COUNTRIES:
                raise HTTPException(
                    400, f"unknown country {country!r}; expected one of {COUNTRIES}"
                )
            systems[country.upper()] = system
        updates[name] = update.model_copy(
            update={"api_key": api_key, "api_secret": api_secret, "systems": systems}
        )
    return updates


def credentials_after(store, name, updates):
    update = updates.get(name)
    if update and update.api_key:
        return True
    return not store.persona(name).missing_credentials


async def apply_mode(app, mode):
    if mode == current_mode(app):
        return
    transport = None if mode == "live" else MockTransport()
    for client in app.state.clients.values():
        await client.use(transport)


@router.get("/settings", response_model=SettingsState)
async def get_settings(request: Request):
    return settings_state(request.app)


@router.put("/settings", response_model=SettingsState)
async def put_settings(body: SettingsUpdate, request: Request):
    app = request.app
    store = app.state.store
    updates = persona_updates(body.personas)
    if body.environment == "live" and not body.confirm_live:
        raise HTTPException(
            409,
            f"refusing to target the live environment ({BASE_URLS['live']}) without "
            f"confirm_live=true",
        )
    if body.mode == "live":
        for name in PERSONAS:
            if not credentials_after(store, name, updates):
                raise HTTPException(
                    409, f"cannot switch mode to live: no API credentials for persona {name!r}"
                )
    for name, update in updates.items():
        if update.api_key:
            store.set_credentials(name, update.api_key, update.api_secret)
        if update.systems:
            store.set_systems(name, {c: s.model_dump() for c, s in update.systems.items()})
        if update.recipients:
            store.set_recipients(name, update.recipients.model_dump())
    if body.environment:
        store.set_environment(body.environment)
    for client in app.state.clients.values():
        await client.sync()
    if body.mode:
        await apply_mode(app, body.mode)
    return settings_state(app)


@router.delete("/settings/credentials", response_model=SettingsState)
async def delete_settings_credentials(request: Request, persona: str = "all"):
    if persona not in CREDENTIAL_TARGETS:
        raise HTTPException(
            400, f"unknown persona {persona!r}; expected one of {CREDENTIAL_TARGETS}"
        )
    store = request.app.state.store
    for name in PERSONAS if persona == "all" else (persona,):
        store.clear_credentials(name)
    for client in request.app.state.clients.values():
        await client.sync()
    return settings_state(request.app)


def live_available(app):
    return not any(client.persona.missing_credentials for client in app.state.clients.values())


@router.get("/mode", response_model=ModeState)
async def get_mode(request: Request):
    return ModeState(mode=current_mode(request.app), live_available=live_available(request.app))


@router.put("/mode", response_model=ModeState)
async def put_mode(body: ModeUpdate, request: Request):
    app = request.app
    if body.mode != current_mode(app):
        missing = [
            name
            for client in app.state.clients.values()
            for name in client.persona.missing_credentials
        ]
        if body.mode == "live" and missing:
            raise HTTPException(409, f"cannot switch to live: {', '.join(missing)} missing in .env")
        await apply_mode(app, body.mode)
    return ModeState(mode=body.mode, live_available=live_available(app))


def collections_for(app):
    settings = app.state.store.settings
    collections = getattr(app.state, "collections", None)
    if collections is None:
        collections = load_collections(settings.spec_dir, settings.poll_timeout_s)
        app.state.collections = collections
    if not collections:
        raise HTTPException(503, f"no Postman collections in {settings.spec_dir}; run: make spec")
    return collections


@router.get("/collections", response_model=list[CollectionSummary])
async def list_collections(request: Request):
    return [
        CollectionSummary(
            id=collection["id"],
            name=collection["name"],
            version=collection["version"],
            steps=len(collection["steps"]),
            notes=len(collection["notes"]),
        )
        for collection in collections_for(request.app).values()
    ]


@router.get("/collections/{collection_id}", response_model=Collection)
async def get_collection(collection_id: str, request: Request):
    collections = collections_for(request.app)
    if collection_id not in collections:
        raise HTTPException(
            404, f"unknown collection {collection_id!r}; expected one of {sorted(collections)}"
        )
    return Collection(**collections[collection_id])


@router.get("/calls", response_model=list[CallRecord])
async def calls(request: Request, since: int | None = None):
    return request.app.state.recorder.list(since_id=since)


@router.get("/events")
async def events(request: Request):
    last_event_id = request.headers.get("Last-Event-ID")
    if last_event_id is not None and not last_event_id.isdigit():
        raise HTTPException(400, "Last-Event-ID must be a numeric call id")
    stream = request.app.state.recorder.sse(request, last_event_id)
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/validate/xsd", response_model=XsdResult)
async def validate_xsd(body: XsdRequest, request: Request):
    # lxml validation is synchronous and CPU-bound; running it inline would block the event
    # loop for every other request, /api/health included.
    try:
        return await asyncio.to_thread(
            request.app.state.validator.validate, body.schema_key, body.xml.encode()
        )
    except KeyError as exc:
        raise HTTPException(
            400, f"unknown schema {body.schema_key!r}; expected one of {sorted(SCHEMAS)}"
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc


SPEC_FIELD_CACHE_MAX = 8


def cached_fields(app, spec_dir, country, operation):
    cache = app.state.spec_fields
    _, digest, _ = load_schemas(spec_dir, country)
    key = (digest, country, operation)
    if key not in cache:
        if len(cache) >= SPEC_FIELD_CACHE_MAX:
            cache.clear()
        cache[key] = field_metadata(spec_dir, country, operation)
    return cache[key]


# Deliberately /spec/fields, not /uapi/fields: the /uapi/{path:path} passthrough below is a
# catch-all that would forward this upstream as a real fiskaly call and log it as one.
@router.get("/spec/fields", response_model=SpecFields)
async def spec_fields(
    request: Request,
    response: Response,
    country: str = Query("IT"),
    operation: str = Query("INVOICE"),
):
    key = country.upper()
    if key not in COUNTRIES:
        raise HTTPException(422, f"unknown country {key!r}; expected one of {COUNTRIES}")
    wanted = operation.upper()
    if wanted not in OPERATION_SCHEMAS:
        raise HTTPException(
            422, f"unknown operation {wanted!r}; expected one of {sorted(OPERATION_SCHEMAS)}"
        )
    settings = request.app.state.store.settings
    try:
        payload = await asyncio.to_thread(
            cached_fields, request.app, settings.spec_dir, key, wanted
        )
    except (FileNotFoundError, KeyError, ValueError) as exc:
        raise HTTPException(503, f"{exc}") from exc
    etag = f'W/"{payload["source_sha256"][:12]}-{wanted}-{key}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return SpecFields(api_version=request.app.state.store.api_version, **payload)


@router.post("/validate/uapi", response_model=UapiSchemaResult)
async def validate_uapi(body: UapiSchemaRequest, request: Request):
    country = body.country.upper()
    if country not in COUNTRIES:
        raise HTTPException(400, f"unknown country {country!r}; expected one of {COUNTRIES}")
    # A wrong or missing operation.type is a finding at /type, not a transport error: the point of
    # the endpoint is to answer with what fiskaly would reject, located in the payload.
    try:
        result = await asyncio.to_thread(
            request.app.state.uapi_schema.validate, body.operation, country
        )
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    return UapiSchemaResult(country=country, **result)


def client_for(app, persona):
    if persona not in PERSONAS:
        raise HTTPException(400, f"unknown persona {persona!r}; expected one of {PERSONAS}")
    return app.state.clients[persona]


def mock_system_id(persona, country):
    return f"mock-{persona}-system-{country.lower()}"


def system_for(app, persona, country):
    if country not in COUNTRIES:
        raise HTTPException(400, f"unknown country {country!r}; expected one of {COUNTRIES}")
    system = app.state.store.persona(persona).systems.get(country)
    if system and system["system_id"]:
        return system["system_id"]
    if app.state.clients[persona].mode == "mock":
        return mock_system_id(persona, country)
    return None


def require_system(app, persona, country):
    system_id = system_for(app, persona, country)
    if not system_id:
        raise HTTPException(
            409, f"{persona.upper()}_SYSTEM_ID_{country} is not set in .env; cannot reach {country}"
        )
    return system_id


@router.get("/onboarding/status", response_model=OnboardingStatus)
async def get_onboarding_status(request: Request, persona: str = "seller"):
    client = client_for(request.app, persona)
    return await onboarding_status(client, request.app.state.store)


@router.post("/onboarding/provision", response_model=ProvisionResult)
async def post_onboarding_provision(body: ProvisionRequest, request: Request):
    app = request.app
    client = client_for(app, body.persona)
    country = body.country.upper()
    if country not in COUNTRIES:
        raise HTTPException(400, f"unknown country {country!r}; expected one of {COUNTRIES}")
    if not body.confirm:
        raise HTTPException(
            409,
            f"refusing to provision in the {app.state.store.environment} environment without "
            f"confirm=true: commissioning is a one-way state transition "
            f"(ACQUIRED -> COMMISSIONED -> DECOMMISSIONED). Billing starts only when a system "
            f"is commissioned on LIVE; TEST resources are not billed.",
        )
    try:
        taxpayer = build_taxpayer(country, body.taxpayer)
    except MissingTaxpayerFields as exc:
        raise HTTPException(400, str(exc)) from exc
    try:
        return await provision(client, app.state.store, country, taxpayer, reuse=body.reuse)
    except TaxpayerExists as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/invoices", response_model=InvoiceCreated)
async def send_invoice(body: InvoiceRequest, request: Request):
    client = client_for(request.app, body.persona)
    system_id = require_system(request.app, body.persona, body.country)
    return await create_invoice(client, system_id, body.operation, body.idempotency_key)


@router.get("/invoices", response_model=RecordListing)
async def list_invoices(
    request: Request,
    persona: str = "seller",
    country: str = "IT",
    record_type: str = Query(INVOICE_TYPE, alias="type"),
    limit: int | None = None,
    token: str | None = None,
):
    client = client_for(request.app, persona)
    system_id = require_system(request.app, persona, country)
    return await list_records(client, record_type, system_id, limit, token)


@router.get("/invoices/{transaction_id}/wait", response_model=TransmissionWait)
async def wait_invoice(
    transaction_id: str, request: Request, persona: str = "seller", timeout: float | None = None
):
    client = client_for(request.app, persona)
    return await wait_for_transmission(client, transaction_id, timeout)


@router.post("/invoices/{transaction_id}/correction", response_model=CorrectionCreated)
async def correct_invoice(transaction_id: str, body: CorrectionRequest, request: Request):
    client = client_for(request.app, body.persona)
    system_id = require_system(request.app, body.persona, body.country)
    return await create_correction(
        client, system_id, transaction_id, body.operation, body.reason, body.idempotency_key
    )


@router.get("/records/{record_id}/artifact", response_model=Artifact)
async def record_artifact(
    record_id: str, request: Request, persona: str = "seller", kind: str = "compliance"
):
    if kind not in ARTIFACT_KINDS:
        raise HTTPException(400, f"unknown kind {kind!r}; expected one of {sorted(ARTIFACT_KINDS)}")
    client = client_for(request.app, persona)
    artifact = await fetch_artifact(client, record_id, artifact_kind(kind))
    return Artifact(record_id=record_id, **artifact)


@router.get("/records/{record_id}/files.zip")
async def record_files(record_id: str, request: Request, persona: str = "seller"):
    client = client_for(request.app, persona)
    content = await fetch_files(client, record_id)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{record_id}.zip"'},
    )


@router.api_route("/uapi/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def passthrough(path: str, request: Request):
    persona = request.headers.get("X-Persona", "seller")
    if persona not in PERSONAS:
        raise HTTPException(400, f"unknown X-Persona {persona!r}; expected one of {PERSONAS}")
    raw = await request.body()
    try:
        body = json.loads(raw) if raw else None
    except ValueError as exc:
        raise HTTPException(400, f"request body is not valid JSON: {exc}") from exc
    url = f"/{path}?{request.url.query}" if request.url.query else f"/{path}"
    client = request.app.state.clients[persona]
    try:
        upstream = await client.request(
            request.method,
            url,
            json=body,
            step="passthrough",
            idempotency_key=request.headers.get("X-Idempotency-Key"),
            step_name=request.headers.get("X-Step"),
            run_id=request.headers.get("X-Run-Id"),
        )
    except httpx.HTTPStatusError as exc:
        upstream = exc.response
    except httpx.TransportError as exc:
        raise HTTPException(502, f"fiskaly API unreachable: {exc}") from exc
    headers = {
        name: upstream.headers[name] for name in UPSTREAM_HEADERS if name in upstream.headers
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
        headers=headers,
    )
