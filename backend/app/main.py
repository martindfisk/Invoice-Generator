import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.fields import field_metadata
from app.mock import MockTransport
from app.recorder import Recorder
from app.routes import UPSTREAM_HEADERS, router
from app.session import SessionStore
from app.settings import COUNTRIES, PERSONAS, Settings
from app.uapi import MissingCredentials, UapiClient
from app.validate import (
    OPERATION_SCHEMAS,
    UapiSchemaValidator,
    XsdValidator,
)
from app.workflow import ArtifactMissing, UpstreamError


@asynccontextmanager
async def lifespan(app):
    settings = app.state.settings
    app.state.recorder = Recorder(settings.recorder_capacity)
    app.state.validator = XsdValidator(settings.vendor_dir)
    app.state.uapi_schema = UapiSchemaValidator(settings.spec_dir)
    app.state.spec_fields = {}
    app.state.store = SessionStore(settings)
    transport = None if settings.uapi_mode == "live" else MockTransport()
    app.state.clients = {
        name: UapiClient(name, app.state.store, app.state.recorder, transport) for name in PERSONAS
    }
    app.state.warmup = asyncio.create_task(warm_spec(app.state.uapi_schema, settings.spec_dir))
    yield
    app.state.warmup.cancel()
    for client in app.state.clients.values():
        await client.aclose()


async def warm_spec(validator, spec_dir):
    # Compiling the OpenAPI graph costs ~220 ms and walking it for field metadata another ~5 ms.
    # Doing it lazily makes the first request a user makes the slow one; doing it here, off the
    # event loop, means nobody ever pays for it.
    log = logging.getLogger(__name__)
    for country in COUNTRIES:
        try:
            await asyncio.to_thread(validator.compile, country)
        except (FileNotFoundError, KeyError, ValueError) as exc:
            log.info("schema warmup skipped for %s: %s", country, exc)
    for operation in OPERATION_SCHEMAS:
        try:
            await asyncio.to_thread(field_metadata, spec_dir, COUNTRIES[0], operation)
        except (FileNotFoundError, KeyError, ValueError) as exc:
            log.info("field metadata warmup skipped for %s: %s", operation, exc)


async def upstream_error(request, exc):
    return JSONResponse(status_code=exc.status_code, content=exc.body)


async def artifact_missing(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


async def missing_credentials(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


def create_app(settings=None):
    settings = settings or Settings()
    settings.validate_live()
    logging.basicConfig(level=settings.log_level)
    app = FastAPI(title="Invoice Generator backend", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=list(UPSTREAM_HEADERS),
    )
    app.add_exception_handler(UpstreamError, upstream_error)
    app.add_exception_handler(ArtifactMissing, artifact_missing)
    app.add_exception_handler(MissingCredentials, missing_credentials)
    app.include_router(router)
    return app


app = create_app()
