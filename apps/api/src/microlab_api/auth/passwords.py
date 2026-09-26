"""Хеширование паролей (Argon2id) и политика паролей."""

import asyncio
import contextlib
import secrets
from typing import Final

import anyio
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from microlab_api.api.errors import ApiError
from microlab_api.schemas.errors import ErrorCode, ErrorDetail

MIN_PASSWORD_LENGTH: Final = 8
# Верхний предел защищает от затратного хеширования очень длинных строк.
MAX_PASSWORD_LENGTH: Final = 256

# Argon2id: t=3, m=64 МиБ, p=4 — второй рекомендованный набор параметров RFC 9106.
_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)
# Хеш для проверки при неизвестном адресе: время ответа не выдаёт наличие учётной записи.
_DUMMY_HASH: Final = _hasher.hash(secrets.token_urlsafe(16))

# Алфавит временных паролей без похожих символов (0/O, 1/l/I).
_TEMP_ALPHABET: Final = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
TEMP_PASSWORD_LENGTH: Final = 14


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if password_hash is None:
        _verify_dummy(password)
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _verify_dummy(password: str) -> None:
    with contextlib.suppress(VerifyMismatchError):
        _hasher.verify(_DUMMY_HASH, password)


def verify_unknown_user(password: str) -> None:
    """Выравнивает время ответа для несуществующего адреса."""
    _verify_dummy(password)


# Argon2 — CPU-bound (≈64 МиБ памяти на вызов): в асинхронных обработчиках хеширование
# выполняется в пуле потоков, а число одновременных вычислений ограничено, чтобы всплеск
# входов не исчерпал память контейнера API и не занял все потоки пула.
_HASH_CONCURRENCY: Final = 3
# Лимитер привязан к event loop: при новом loop (тесты, перезапуск) создаётся заново.
_hash_limiter: tuple[asyncio.AbstractEventLoop, anyio.CapacityLimiter] | None = None


def _limiter() -> anyio.CapacityLimiter:
    global _hash_limiter  # noqa: PLW0603 — лимитер создаётся лениво внутри event loop
    loop = asyncio.get_running_loop()
    if _hash_limiter is None or _hash_limiter[0] is not loop:
        _hash_limiter = (loop, anyio.CapacityLimiter(_HASH_CONCURRENCY))
    return _hash_limiter[1]


async def hash_password_async(password: str) -> str:
    return await anyio.to_thread.run_sync(hash_password, password, limiter=_limiter())


async def verify_password_async(password_hash: str | None, password: str) -> bool:
    return await anyio.to_thread.run_sync(
        verify_password, password_hash, password, limiter=_limiter()
    )


async def verify_unknown_user_async(password: str) -> None:
    await anyio.to_thread.run_sync(verify_unknown_user, password, limiter=_limiter())


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def check_password_policy(password: str, email: str, field: str = "password") -> None:
    problem: tuple[str, str] | None = None
    if len(password) < MIN_PASSWORD_LENGTH:
        problem = ("too_short", f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    elif len(password) > MAX_PASSWORD_LENGTH:
        problem = ("too_long", f"Password must be at most {MAX_PASSWORD_LENGTH} characters.")
    elif password.strip().lower() == email.strip().lower():
        problem = ("equals_email", "Password must not be the same as the email.")
    if problem is not None:
        raise ApiError(
            422,
            ErrorCode.WEAK_PASSWORD,
            "Password does not meet the policy.",
            [ErrorDetail(field=field, message=problem[1], code=problem[0])],
        )


def generate_temporary_password() -> str:
    return "".join(secrets.choice(_TEMP_ALPHABET) for _ in range(TEMP_PASSWORD_LENGTH))
