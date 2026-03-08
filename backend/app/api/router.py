from fastapi import APIRouter

from app.api.routes.experiments import router as experiments_router
from app.api.routes.health import router as health_router
from app.api.routes.metrics import router as metrics_router
from app.api.routes.narration import router as narration_router
from app.api.routes.runtime import router as runtime_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(metrics_router)
api_router.include_router(runtime_router)
api_router.include_router(experiments_router)
api_router.include_router(narration_router)
