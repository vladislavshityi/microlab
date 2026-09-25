import asyncio

import pytest
from pydantic import SecretStr
from sqlalchemy import func, insert, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from microlab_api.config import Environment, Settings
from microlab_api.models import User
from microlab_api.scripts import seed_dev_user as seed

pytestmark = pytest.mark.anyio


async def _users(engine: AsyncEngine) -> list[tuple[object, str]]:
    async with engine.connect() as conn:
        rows = await conn.execute(select(User.id, User.username))
        return [(row.id, row.username) for row in rows]


@pytest.mark.usefixtures("clean_db")
async def test_seed_is_idempotent(engine: AsyncEngine) -> None:
    assert await seed.seed_dev_user(engine) is True
    assert await seed.seed_dev_user(engine) is False

    assert await _users(engine) == [(seed.DEV_USER_ID, "dev-user")]


@pytest.mark.usefixtures("clean_db")
async def test_seed_fails_on_conflicting_username(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(insert(User).values(username="dev-user"))

    with pytest.raises(seed.SeedError):
        await seed.seed_dev_user(engine)


@pytest.mark.parametrize("env", ["test", "production"])
@pytest.mark.usefixtures("clean_db")
async def test_seed_refuses_outside_development(
    engine: AsyncEngine,
    test_database_url: str,
    env: Environment,
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = Settings(env=env, database_url=SecretStr(test_database_url))

    assert seed.main(settings) == 2
    assert "refusing to run" in capsys.readouterr().err
    async with engine.connect() as conn:
        assert await conn.scalar(select(func.count()).select_from(User)) == 0


async def _count_and_truncate(database_url: str) -> int:
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as conn:
            count = await conn.scalar(select(func.count()).select_from(User))
            await conn.execute(text("TRUNCATE users, projects CASCADE"))
    finally:
        await engine.dispose()
    return count or 0


def test_main_is_idempotent_in_development(
    test_database_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    # Синхронный тест: main() сам управляет event loop через asyncio.run().
    settings = Settings(env="development", database_url=SecretStr(test_database_url))

    assert seed.main(settings) == 0
    assert seed.main(settings) == 0

    out = capsys.readouterr().out
    assert "dev-user (00000000-0000-0000-0000-000000000001) created" in out
    assert "already exists" in out
    assert asyncio.run(_count_and_truncate(test_database_url)) == 1
