import asyncio

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from microlab_api.config import Settings

HEALTH_CHECK_TIMEOUT_SECONDS = 2.0


def create_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        # Никогда не выводить SQL/DSN в логи.
        echo=False,
        hide_parameters=True,
    )


class Database:
    """Владеет engine одного экземпляра приложения.

    Создание не открывает соединений: они открываются лениво при первом использовании.
    """

    def __init__(self, settings: Settings) -> None:
        self.engine = create_engine(settings)

    async def ping(self, seconds: float = HEALTH_CHECK_TIMEOUT_SECONDS) -> None:
        """Выполняет ``SELECT 1``. Бросает исключение при ошибке или по истечении ``seconds``."""
        async with asyncio.timeout(seconds), self.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    async def dispose(self) -> None:
        await self.engine.dispose()


def get_database(request: Request) -> Database:
    database: Database = request.app.state.database
    return database
