from __future__ import annotations

import redis.asyncio as aioredis
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings

router = APIRouter(tags=["health"])

settings = get_settings()


@router.get(
    "/health",
    summary="Liveness check",
    description="Shallow liveness probe — confirms the process is alive.",
)
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get(
    "/health/ready",
    summary="Readiness check",
    description="Deep readiness probe — checks DB and Redis connectivity.",
    response_model=None,
)
async def readiness() -> JSONResponse | dict:
    checks: dict[str, str] = {}

    # Check database
    try:
        engine = create_async_engine(settings.database_url, pool_size=1, max_overflow=0)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        await engine.dispose()
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "unreachable"

    # Check Redis
    try:
        r = aioredis.from_url(settings.redis_url, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unreachable"

    # Only the database is on the critical request path.
    # Redis is used for caching/pubsub — report its status but don't fail readiness.
    db_ok = checks["database"] == "ok"
    if not db_ok:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "checks": checks},
        )

    status = "ok" if checks["redis"] == "ok" else "degraded"
    return {"status": status, "checks": checks}
