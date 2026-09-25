"""Фикстуры тестов.

Тесты работают с настоящей базой PostgreSQL ``<основная база>_test`` (например,
``microlab_test``) на сервере из ``MICROLAB_DATABASE_URL``. База создаётся при первом
использовании, а её схема ``public`` пересоздаётся и мигрируется до ``head`` один раз
за сессию. Основная база для разработки никогда не затрагивается.
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import make_url, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from microlab_api.app import create_app
from microlab_api.config import Settings, get_settings
from microlab_api.db.database import create_engine

API_DIR = Path(__file__).resolve().parents[1]
# На loopback порт 1 никто не слушает: соединения отклоняются сразу.
UNREACHABLE_DATABASE_URL = "postgresql+asyncpg://microlab:secret-password@127.0.0.1:1/microlab"


def _test_database_url() -> str:
    url = make_url(get_settings().database_url.get_secret_value())
    return url.set(database=f"{url.database}_test").render_as_string(hide_password=False)


async def _recreate_test_database(test_url: str) -> None:
    url = make_url(test_url)
    admin = create_async_engine(
        url.set(database="postgres"), isolation_level="AUTOCOMMIT", hide_parameters=True
    )
    try:
        async with admin.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": url.database}
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        await admin.dispose()

    engine = create_async_engine(url, isolation_level="AUTOCOMMIT", hide_parameters=True)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
    finally:
        await engine.dispose()


def make_alembic_config(database_url: str) -> Config:
    config = Config(API_DIR / "alembic.ini")
    config.attributes["database_url"] = database_url
    # Не трогаем настройку логирования pytest (fileConfig отключил бы существующие логгеры).
    config.attributes["configure_logger"] = False
    return config


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
def test_database_url() -> str:
    url = _test_database_url()
    asyncio.run(_recreate_test_database(url))
    command.upgrade(make_alembic_config(url), "head")
    return url


@pytest.fixture
def test_settings(test_database_url: str) -> Settings:
    return Settings(
        env="test",
        database_url=SecretStr(test_database_url),
        log_level="INFO",
        log_format="json",
    )


@pytest.fixture
async def engine(test_settings: Settings) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(test_settings)
    yield engine
    await engine.dispose()


@pytest.fixture
async def clean_db(engine: AsyncEngine) -> AsyncIterator[None]:
    truncate = text("TRUNCATE users, projects RESTART IDENTITY CASCADE")
    async with engine.begin() as conn:
        await conn.execute(truncate)
    yield
    async with engine.begin() as conn:
        await conn.execute(truncate)


@pytest.fixture
async def client(test_settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(test_settings)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http
    await app.state.database.dispose()


@pytest.fixture
def unreachable_settings() -> Settings:
    return Settings(
        env="test",
        database_url=SecretStr(UNREACHABLE_DATABASE_URL),
        log_level="INFO",
        log_format="json",
    )
