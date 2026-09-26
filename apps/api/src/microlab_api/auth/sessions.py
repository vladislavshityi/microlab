"""Сессии входа: случайный токен в cookie, в БД — только его SHA-256.

Сессия действует до истечения абсолютного срока (``expires_at``) и завершается раньше,
если пользователь не обращался к API дольше срока простоя (``last_seen``).
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.config import Settings
from microlab_api.models import AuthSession, User

SESSION_COOKIE: Final = "microlab_session"
# last_seen обновляется не чаще этого интервала: меньше записей в БД.
LAST_SEEN_RESOLUTION: Final = timedelta(minutes=1)
MAX_USER_AGENT_LENGTH: Final = 512


def now_utc() -> datetime:
    return datetime.now(UTC)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session(
    db: AsyncSession,
    settings: Settings,
    user: User,
    *,
    user_agent: str | None,
    ip: str | None,
) -> str:
    """Создаёт сессию и возвращает токен для cookie (в БД не сохраняется)."""
    token = secrets.token_urlsafe(32)
    now = now_utc()
    db.add(
        AuthSession(
            id=hash_token(token),
            user_id=user.id,
            created_at=now,
            last_seen=now,
            expires_at=now + timedelta(hours=settings.session_absolute_timeout_hours),
            user_agent=None if user_agent is None else user_agent[:MAX_USER_AGENT_LENGTH],
            ip=ip,
        )
    )
    return token


async def resolve_session(
    db: AsyncSession, settings: Settings, token: str
) -> tuple[AuthSession, User] | None:
    """Действующая сессия и активный пользователь или None. Истёкшая сессия удаляется."""
    if not token or len(token) > 128:
        return None
    row = (
        await db.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.id == hash_token(token))
        )
    ).one_or_none()
    if row is None:
        return None
    auth_session, user = row
    now = now_utc()
    idle_limit = auth_session.last_seen + timedelta(hours=settings.session_idle_timeout_hours)
    if auth_session.expires_at <= now or idle_limit <= now or not user.is_active:
        await db.delete(auth_session)
        await db.commit()
        return None
    if now - auth_session.last_seen >= LAST_SEEN_RESOLUTION:
        auth_session.last_seen = now
        await db.commit()
    return auth_session, user


async def delete_session(db: AsyncSession, token: str) -> None:
    await db.execute(delete(AuthSession).where(AuthSession.id == hash_token(token)))


async def delete_user_sessions(
    db: AsyncSession, user_id: uuid.UUID, *, except_id: str | None = None
) -> None:
    stmt = delete(AuthSession).where(AuthSession.user_id == user_id)
    if except_id is not None:
        stmt = stmt.where(AuthSession.id != except_id)
    await db.execute(stmt)
