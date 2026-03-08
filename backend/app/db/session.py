from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings


def _async_url(url: str) -> str:
    """Ensure the DATABASE_URL uses the asyncpg driver."""
    if url.startswith("postgresql+asyncpg://"):
        result = url
    elif url.startswith("postgresql+"):
        # Replace any other driver with asyncpg
        result = "postgresql+asyncpg://" + url.split("://", 1)[1]
    elif url.startswith("postgresql://"):
        result = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    else:
        result = url
    # asyncpg uses 'ssl' not 'sslmode'
    result = result.replace("sslmode=", "ssl=")
    return result


def create_engine_for_url(database_url: str) -> AsyncEngine:
    return create_async_engine(_async_url(database_url), future=True)


def create_session_factory(
    database_url: str,
) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    engine = create_engine_for_url(database_url)
    return engine, async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


settings = get_settings()

engine, AsyncSessionLocal = create_session_factory(settings.database_url)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
