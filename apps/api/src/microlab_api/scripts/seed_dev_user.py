"""Создаёт пользователя для разработки (dev-user). Идемпотентно; только для development.

До появления аутентификации все проекты принадлежат этому пользователю.

Использование: ``uv run python -m microlab_api.scripts.seed_dev_user``
"""

import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from microlab_api.config import Settings, get_settings
from microlab_api.db.database import create_engine
from microlab_api.dev_user import DEV_USER_ID, DEV_USER_USERNAME
from microlab_api.models import User

__all__ = ["DEV_USER_ID", "DEV_USER_USERNAME", "SeedError", "main", "seed_dev_user"]


class SeedError(RuntimeError):
    pass


async def seed_dev_user(engine: AsyncEngine) -> bool:
    """Гарантирует наличие строки dev-user. Возвращает True, если её создал этот вызов."""
    stmt = (
        insert(User)
        .values(id=DEV_USER_ID, username=DEV_USER_USERNAME)
        .on_conflict_do_nothing()
        .returning(User.id)
    )
    async with engine.begin() as conn:
        created = (await conn.execute(stmt)).scalar_one_or_none() is not None
        if not created:
            existing = (
                await conn.execute(select(User.username).where(User.id == DEV_USER_ID))
            ).scalar_one_or_none()
            if existing != DEV_USER_USERNAME:
                raise SeedError(
                    f"conflicting user row: expected id {DEV_USER_ID} "
                    f"with username {DEV_USER_USERNAME!r}"
                )
    return created


async def _run(settings: Settings) -> bool:
    engine = create_engine(settings)
    try:
        return await seed_dev_user(engine)
    finally:
        await engine.dispose()


def main(settings: Settings | None = None) -> int:
    settings = settings or get_settings()
    if settings.env != "development":
        print(
            f"seed_dev_user: refusing to run with MICROLAB_ENV={settings.env!r}; "
            "the dev-user is allowed only in 'development'.",
            file=sys.stderr,
        )
        return 2
    try:
        created = asyncio.run(_run(settings))
    except SeedError as exc:
        print(f"seed_dev_user: {exc}", file=sys.stderr)
        return 1
    state = "created" if created else "already exists"
    print(f"seed_dev_user: {DEV_USER_USERNAME} ({DEV_USER_ID}) {state}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
