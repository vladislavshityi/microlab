"""Окружение Alembic (async, asyncpg).

URL берётся из ``config.attributes["database_url"]``, если он задан программно (тесты),
иначе из ``MICROLAB_DATABASE_URL`` через :class:`microlab_api.config.Settings`.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from microlab_api.config import get_settings
from microlab_api.models import Base

config = context.config

if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Ключ advisory lock PostgreSQL: несколько экземпляров API, стартующих одновременно,
# применяют миграции по очереди.
_MIGRATION_LOCK_KEY = 0x4D4C4D49  # "MLMI"


def _database_url() -> str:
    url = config.attributes.get("database_url")
    if isinstance(url, str):
        return url
    return get_settings().database_url.get_secret_value()


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(_database_url(), poolclass=pool.NullPool, hide_parameters=True)
    try:
        async with engine.connect() as lock_connection:
            locked = lock_connection.dialect.name == "postgresql"
            if locked:
                await lock_connection.execute(
                    text("SELECT pg_advisory_lock(:key)"), {"key": _MIGRATION_LOCK_KEY}
                )
                await lock_connection.commit()
            try:
                async with engine.connect() as connection:
                    await connection.run_sync(do_run_migrations)
            finally:
                if locked:
                    await lock_connection.execute(
                        text("SELECT pg_advisory_unlock(:key)"), {"key": _MIGRATION_LOCK_KEY}
                    )
                    await lock_connection.commit()
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
