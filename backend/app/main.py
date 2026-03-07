import traceback
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.api.router import api_router
from app.core import langfuse as lf
from app.core import posthog as ph
from app.core.config import get_settings
from app.logging import setup_logging

setup_logging()
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    ph.init()
    lf.init()
    ph.capture("backend_started", {"version": settings.app_version})
    yield
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExceptionCaptureMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        try:
            response = await call_next(request)
            return response
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


app.add_middleware(ExceptionCaptureMiddleware)
app.include_router(api_router)
