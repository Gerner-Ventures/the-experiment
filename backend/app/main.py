import traceback
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.api.router import api_router
from app.api.runtime import ExperimentRuntime
from app.core import langfuse as lf
from app.core import posthog as ph
from app.core.config import Settings, get_settings
from app.core.runtime_factory import build_runtime
from app.logging import setup_logging, shutdown_logging

setup_logging()


class ExceptionCaptureMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            return await call_next(request)
        except Exception as exc:
            ph.capture(
                "backend_exception",
                {
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                    "path": request.url.path,
                    "method": request.method,
                },
            )
            raise


def create_app(
    *,
    settings_override: Settings | None = None,
    runtime: ExperimentRuntime | None = None,
) -> FastAPI:
    settings = settings_override or get_settings()
    db_engine = None
    if runtime is None:
        runtime, db_engine = build_runtime(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        ph.init()
        lf.init()
        ph.capture("backend_started", {"version": settings.app_version})
        yield
        if db_engine is not None:
            await db_engine.dispose()
        shutdown_logging()
        lf.shutdown()
        ph.shutdown()

    app = FastAPI(
        title=settings.app_name,
        description=(
            "AI agent simulation engine.\n\n"
            "Interactive API docs are available at `/docs`, ReDoc is available at `/redoc`, "
            "and the OpenAPI schema is available at `/openapi.json`."
        ),
        version=settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.runtime = runtime
    app.state.runtime_mode = settings.backend_runtime_mode

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(ExceptionCaptureMiddleware)
    app.include_router(api_router)
    return app


app = create_app()
