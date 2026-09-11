import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.mock import MockTransport
from app.recorder import Recorder
from app.routes import UPSTREAM_HEADERS, cached_fields, router
from app.settings import COUNTRIES, Settings
from app.store import SettingsStore
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
    app.state.store = SettingsStore(settings)
    transport = None if app.state.store.mode == "live" else MockTransport()
    app.state.client = UapiClient(app.state.store, app.state.recorder, transport)
    app.state.warmup = asyncio.create_task(warm_spec(app, settings.spec_dir))
    yield
    app.state.warmup.cancel()
    await app.state.client.aclose()


async def warm_spec(app, spec_dir):
    # Compiling the OpenAPI graph costs ~220 ms and walking it for field metadata another ~5 ms.
    # Doing it lazily makes the first request a user makes the slow one; doing it here, off the
    # event loop and into the same caches the routes read, means nobody ever pays for it.
    log = logging.getLogger(__name__)
    # The vendored XSDs take the same treatment: compiled here so the first
    # /api/validate/xsd does not pay for it. warm() skips missing assets itself.
    await asyncio.to_thread(app.state.validator.warm)
    for country in COUNTRIES:
        try:
            await asyncio.to_thread(app.state.uapi_schema.compile, country)
        except (FileNotFoundError, KeyError, ValueError) as exc:
            log.info("schema warmup skipped for %s: %s", country, exc)
    for country in COUNTRIES:
        for operation in OPERATION_SCHEMAS:
            try:
                await asyncio.to_thread(cached_fields, app, spec_dir, country, operation)
            except (FileNotFoundError, KeyError, ValueError) as exc:
                log.info("field metadata warmup skipped for %s/%s: %s", country, operation, exc)


async def upstream_error(request, exc):
    return JSONResponse(status_code=exc.status_code, content=exc.body)


async def artifact_missing(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


async def missing_credentials(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


async def upstream_unreachable(request, exc):
    return JSONResponse(status_code=502, content={"detail": f"fiskaly API unreachable: {exc}"})


MAX_BODY_BYTES = 10 * 1024 * 1024


async def body_size_guard(request, call_next):
    # The body is parsed on the event loop before any handler runs; a runaway payload must be
    # refused from the declared length, not after it was read.
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": f"request body exceeds {MAX_BODY_BYTES // (1024 * 1024)} MB"},
        )
    return await call_next(request)


def create_app(settings=None):
    # Live mode with missing credentials is not a boot error: the credentials may arrive from
    # the settings dialog, and every call fails loudly at the point of use (MissingCredentials).
    settings = settings or Settings()
    logging.basicConfig(level=settings.log_level)
    app = FastAPI(title="Invoice Generator backend", lifespan=lifespan)
    app.state.settings = settings
    app.middleware("http")(body_size_guard)
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
    app.add_exception_handler(httpx.TransportError, upstream_unreachable)
    app.include_router(router)
    return app


app = create_app()
