"""Фикстуры тестов.

Тесты работают с настоящей базой PostgreSQL ``<основная база>_test`` (например,
``microlab_test``) на сервере из ``MICROLAB_DATABASE_URL``. База создаётся при первом
использовании, а её схема ``public`` пересоздаётся и мигрируется до ``head`` один раз
за сессию. Основная база для разработки никогда не затрагивается.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import insert, make_url, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from microlab_api.api.current_user import get_current_user
from microlab_api.app import create_app
from microlab_api.auth.passwords import hash_password
from microlab_api.config import Settings, get_settings
from microlab_api.db.database import create_engine
from microlab_api.models import User, UserRole

API_DIR = Path(__file__).resolve().parents[1]
TRUNCATE_ALL = text(
    "TRUNCATE users, projects, groups, group_members, invite_codes, sessions "
    "RESTART IDENTITY CASCADE"
)
# Заголовок защиты от CSRF, который отправляет frontend.
CSRF_HEADERS = {"X-MicroLab-Request": "1"}
DEFAULT_PASSWORD = "correct-horse-battery"  # noqa: S105 - тестовый пароль
STUDENT_EMAIL = "student@example.edu"
# Хеш вычисляется один раз: Argon2id намеренно медленный.
_HASHES: dict[str, str] = {}


def password_hash(password: str) -> str:
    if password not in _HASHES:
        _HASHES[password] = hash_password(password)
    return _HASHES[password]


async def create_user(  # noqa: PLR0913
    engine: AsyncEngine,
    email: str,
    role: UserRole = UserRole.STUDENT,
    *,
    password: str = DEFAULT_PASSWORD,
    must_change_password: bool = False,
    is_active: bool = True,
    name: str | None = None,
) -> object:
    async with engine.begin() as conn:
        return await conn.scalar(
            insert(User)
            .values(
                email=email,
                display_name=name or email.split("@", maxsplit=1)[0],
                role=role,
                password_hash=password_hash(password),
                must_change_password=must_change_password,
                is_active=is_active,
            )
            .returning(User.id)
        )


async def login(http: AsyncClient, email: str, password: str = DEFAULT_PASSWORD) -> None:
    response = await http.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text


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
    async with engine.begin() as conn:
        await conn.execute(TRUNCATE_ALL)
    yield
    async with engine.begin() as conn:
        await conn.execute(TRUNCATE_ALL)


@pytest.fixture
async def client(test_settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(test_settings)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(
        transport=transport, base_url="http://testserver", headers=CSRF_HEADERS
    ) as http:
        yield http
    await app.state.database.dispose()


@pytest.fixture
async def student_client(client: AsyncClient, engine: AsyncEngine, clean_db: None) -> AsyncClient:
    """Клиент, вошедший как студент ``STUDENT_EMAIL``."""
    await create_user(engine, STUDENT_EMAIL)
    await login(client, STUDENT_EMAIL)
    return client


@pytest.fixture
def unreachable_settings() -> Settings:
    return Settings(
        env="test",
        database_url=SecretStr(UNREACHABLE_DATABASE_URL),
        log_level="INFO",
        log_format="json",
    )


@pytest.fixture
def seeded_db(test_database_url: str) -> None:
    """Чистая база со студентом ``STUDENT_EMAIL`` для синхронных тестов (TestClient)."""

    async def prepare() -> None:
        engine = create_async_engine(test_database_url)
        try:
            async with engine.begin() as conn:
                await conn.execute(TRUNCATE_ALL)
            await create_user(engine, STUDENT_EMAIL)
        finally:
            await engine.dispose()

    asyncio.run(prepare())


def fake_student() -> User:
    return User(
        id=uuid.uuid4(),
        email="fake@example.edu",
        display_name="fake",
        role=UserRole.STUDENT,
        is_active=True,
        must_change_password=False,
    )


def authenticate_as(app: FastAPI, user: User) -> None:
    """Подменяет текущего пользователя (тесты без базы данных)."""

    async def current() -> User:
        return user

    app.dependency_overrides[get_current_user] = current


def login_sync(http: TestClient, email: str = STUDENT_EMAIL) -> None:
    http.headers.update(CSRF_HEADERS)
    response = http.post("/api/v1/auth/login", json={"email": email, "password": DEFAULT_PASSWORD})
    assert response.status_code == 200, response.text
