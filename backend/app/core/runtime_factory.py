from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine

from app.agents.service import AgentService
from app.api.runtime import ExperimentRuntime
from app.api.store import ExperimentStore, SqlAlchemyExperimentStore
from app.api.ws_manager import ConnectionManager
from app.core.config import Settings
from app.db.session import create_session_factory
from app.engine import SimulationEngine
from app.gm import GMService
from app.headless.factory import (
    sync_provider_credentials_to_env,
    validate_live_mode_configuration,
)
from app.tts import NarrationTTSService


def build_runtime(
    settings: Settings,
    *,
    store: ExperimentStore | None = None,
    connection_manager: ConnectionManager | None = None,
) -> tuple[ExperimentRuntime, AsyncEngine | None]:
    if store is None:
        db_engine, session_factory = create_session_factory(settings.database_url)
        store = SqlAlchemyExperimentStore(session_factory)
    else:
        db_engine = None

    runtime_mode = settings.backend_runtime_mode
    connection_manager = connection_manager or ConnectionManager()
    tts_service = NarrationTTSService(settings)
    if runtime_mode not in {"default", "smoke_mock", "smoke_live"}:
        raise ValueError(f"Unsupported backend runtime mode: {runtime_mode}")

    if runtime_mode == "smoke_live":
        sync_provider_credentials_to_env()
        validate_live_mode_configuration()

    random_seed = settings.smoke_seed if runtime_mode != "default" else 7
    gm_service = GMService()
    agent_service = AgentService()
    engine = SimulationEngine(
        gm_service=gm_service,
        agent_service=agent_service,
        random_seed=random_seed,
    )
    runtime = ExperimentRuntime(
        store=store,
        engine=engine,
        gm_service=gm_service,
        connection_manager=connection_manager,
        tts_service=tts_service,
        mock_seed=settings.smoke_seed,
        llm_mode="mock" if runtime_mode == "smoke_mock" else "live",
    )
    return runtime, db_engine
