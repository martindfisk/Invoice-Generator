import asyncio
import json

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.inbox import after, get_inbox_item, list_inbox, simulate_delivery, sort_inbox
from app.mock import MockTransport
from app.models import (
    Artifact,
    Config,
    CorrectionCreated,
    CorrectionRequest,
    Health,
    InboxItem,
    InvoiceCreated,
    InvoiceRequest,
    ModeState,
    ModeUpdate,
    RecordListing,
    SimulateRequest,
    TransmissionWait,
    UapiSchemaRequest,
    UapiSchemaResult,
    XsdRequest,
    XsdResult,
)
from app.recorder import CallRecord
from app.settings import COUNTRIES, PERSONAS
from app.validate import SCHEMAS
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


def current_mode(app):
    return app.state.clients["seller"].mode


@router.get("/health", response_model=Health)
async def health(request: Request):
    settings = request.app.state.settings
    return Health(
        status="ok", mode=current_mode(request.app), api_version=settings.uapi_api_version
    )


@router.get("/config", response_model=Config)
async def config(request: Request):
    settings = request.app.state.settings
    personas = {}
    for name in PERSONAS:
        systems = settings.persona(name).systems
        personas[name] = {country: system for country, system in systems.items() if system}
    return Config(
        mode=current_mode(request.app),
        environment=settings.environment,
        api_version=settings.uapi_api_version,
        reception_mode=settings.reception_mode,
        personas=personas,
    )


def live_available(app):
    return not any(client.persona.missing_credentials for client in app.state.clients.values())


@router.get("/mode", response_model=ModeState)
async def get_mode(request: Request):
    return ModeState(mode=current_mode(request.app), live_available=live_available(request.app))


@router.put("/mode", response_model=ModeState)
async def put_mode(body: ModeUpdate, request: Request):
    state = request.app.state
    if body.mode != current_mode(request.app):
        missing = [
            name for client in state.clients.values() for name in client.persona.missing_credentials
        ]
        if body.mode == "live" and missing:
            raise HTTPException(409, f"cannot switch to live: {', '.join(missing)} missing in .env")
        transport = None if body.mode == "live" else MockTransport()
        for client in state.clients.values():
            await client.use(transport)
    return ModeState(mode=body.mode, live_available=live_available(request.app))


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
    system = app.state.settings.persona(persona).systems.get(country)
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


@router.get("/inbox", response_model=list[InboxItem])
async def inbox_listing(
    request: Request, persona: str = "buyer", country: str = "IT", since: str | None = None
):
    client = client_for(request.app, persona)
    settings = request.app.state.settings
    items = [
        item for item in request.app.state.simulated_inbox if after(item["received_at"], since)
    ]
    system_id = system_for(request.app, persona, country)
    if system_id:
        entries = await list_inbox(client, system_id, since)
        items += await asyncio.gather(*(get_inbox_item(client, entry["id"]) for entry in entries))
    elif settings.reception_mode == "live":
        raise HTTPException(
            409, f"{persona.upper()}_SYSTEM_ID_{country} is not set in .env; cannot list receptions"
        )
    return sort_inbox(items)


@router.post("/inbox/simulate", response_model=InboxItem)
async def inbox_simulate(body: SimulateRequest, request: Request):
    return simulate_delivery(request.app.state.simulated_inbox, body.xml, body.meta)


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
