from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine

from app.agents.mock_brain import MockAgentBrain
from app.agents.service import AgentService
from app.api.runtime import ExperimentRuntime
from app.api.store import ExperimentStore, SqlAlchemyExperimentStore
from app.api.ws_manager import ConnectionManager
from app.core.config import Settings
from app.db.session import create_session_factory
from app.engine import SimulationEngine
from app.gm import GMService
from app.headless.factory import (
    NoOpMemoryLLMService,
    RuleBasedGMService,
    sync_provider_credentials_to_env,
    validate_live_mode_configuration,
)


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
    gm_service: GMService

    if runtime_mode == "default":
        return (
            ExperimentRuntime(
                store=store,
                connection_manager=connection_manager,
            ),
            db_engine,
        )

    if runtime_mode == "smoke_mock":
        gm_service = RuleBasedGMService()
        agent_service = AgentService(
            brain=MockAgentBrain(seed=settings.smoke_seed),
            memory_llm_service=NoOpMemoryLLMService(),
        )
        engine = SimulationEngine(
            gm_service=gm_service,
            agent_service=agent_service,
            random_seed=settings.smoke_seed,
        )
        return (
            ExperimentRuntime(
                store=store,
                engine=engine,
                gm_service=gm_service,
                connection_manager=connection_manager,
            ),
            db_engine,
        )

    sync_provider_credentials_to_env()
    validate_live_mode_configuration()
    gm_service = GMService()
    engine = SimulationEngine(
        gm_service=gm_service,
        random_seed=settings.smoke_seed,
    )
    return (
        ExperimentRuntime(
            store=store,
            engine=engine,
            gm_service=gm_service,
            connection_manager=connection_manager,
        ),
        db_engine,
    )
