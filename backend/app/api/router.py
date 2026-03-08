from fastapi import APIRouter

from app.api.routes.experiments import router as experiments_router
from app.api.routes.health import metrics_router, router as health_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router)
api_router.include_router(metrics_router)
api_router.include_router(experiments_router)
