from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    summary="Check backend health",
    description="Return a minimal liveness payload for local dev, CI, and platform probes.",
)
async def health() -> dict[str, str]:
    return {"status": "ok"}
