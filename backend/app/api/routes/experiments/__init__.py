from __future__ import annotations

from fastapi import APIRouter

from . import agents, analytics, core, gm, history, log, usage, ws

router = APIRouter()
prefix = "/experiments"

router.include_router(core.router, prefix=prefix)
router.include_router(gm.router, prefix=prefix)
router.include_router(agents.router, prefix=prefix)
router.include_router(log.router, prefix=prefix)
router.include_router(analytics.router, prefix=prefix)
router.include_router(history.router, prefix=prefix)
router.include_router(usage.router, prefix=prefix)
router.include_router(ws.router, prefix=prefix)
