"""Создаёт учётную запись администратора (первый вход в систему).

Использование::

    python -m microlab_api.scripts.create_admin --email admin@example.edu [--name "Имя"]

Пароль не принимается аргументом командной строки (он попал бы в историю shell и список
процессов): он читается из переменной ``MICROLAB_ADMIN_PASSWORD``, иначе запрашивается
в терминале, иначе читается первой строкой stdin.
"""

import argparse
import asyncio
import getpass
import os
import sys

from sqlalchemy import insert, select

from microlab_api.api.errors import ApiError
from microlab_api.auth import passwords
from microlab_api.config import Settings, get_settings
from microlab_api.db.database import create_engine
from microlab_api.models import User, UserRole
from microlab_api.schemas.auth import AdminUserCreate

PASSWORD_ENV = "MICROLAB_ADMIN_PASSWORD"  # noqa: S105 - имя переменной окружения


def _read_password() -> str:
    from_env = os.environ.get(PASSWORD_ENV)
    if from_env:
        return from_env
    if sys.stdin.isatty():
        first = getpass.getpass("Пароль администратора: ")
        if getpass.getpass("Повторите пароль: ") != first:
            raise ValueError("пароли не совпадают")
        return first
    return sys.stdin.readline().rstrip("\n")


async def create_admin(settings: Settings, email: str, name: str, password: str) -> bool:
    """Создаёт администратора. False — адрес уже занят."""
    engine = create_engine(settings)
    try:
        async with engine.begin() as conn:
            exists = await conn.scalar(select(User.id).where(User.email == email))
            if exists is not None:
                return False
            await conn.execute(
                insert(User).values(
                    email=email,
                    display_name=name,
                    password_hash=passwords.hash_password(password),
                    role=UserRole.ADMIN,
                    is_active=True,
                    must_change_password=False,
                )
            )
        return True
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    parser = argparse.ArgumentParser(prog="create_admin", description=__doc__.splitlines()[0])
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="Администратор")
    args = parser.parse_args(argv)
    try:
        password = _read_password()
        data = AdminUserCreate(
            email=args.email, display_name=args.name, role="admin", password=password
        )
        passwords.check_password_policy(password, data.email)
    except ApiError as exc:
        details = "; ".join(d.message for d in exc.details) or exc.message
        print(f"create_admin: {details}", file=sys.stderr)
        return 2
    except ValueError as exc:
        print(f"create_admin: {exc}", file=sys.stderr)
        return 2
    created = asyncio.run(
        create_admin(settings or get_settings(), data.email, data.display_name, password)
    )
    if not created:
        print(f"create_admin: {data.email} already exists", file=sys.stderr)
        return 1
    print(f"create_admin: admin {data.email} created")
    return 0


if __name__ == "__main__":
    sys.exit(main())
