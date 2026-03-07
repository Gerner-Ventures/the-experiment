from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.ws_manager import ConnectionManager
from app.core.config import get_settings
from app.engine.runner import ExperimentRunner
from app.logging import setup_logging

setup_logging()
settings = get_settings()

# Global app singletons
ws_manager = ConnectionManager()
experiment_runner = ExperimentRunner(ws_manager)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield


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
app.include_router(api_router)
