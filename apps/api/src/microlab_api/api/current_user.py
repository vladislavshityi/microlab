"""Определение текущего пользователя запроса.

Единственное место, которое знает, кто выполняет запрос. До появления аутентификации
в development и test это всегда dev-user; в production без аутентификации API проектов
недоступен. При добавлении аутентификации меняется только эта зависимость.
"""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.errors import ApiError
from microlab_api.config import Settings
from microlab_api.db.database import get_session
from microlab_api.dev_user import DEV_USER_ID
from microlab_api.models import User
from microlab_api.schemas.errors import ErrorCode

SEED_COMMAND = "uv run python -m microlab_api.scripts.seed_dev_user"


async def get_current_user(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> User:
    settings: Settings = request.app.state.settings
    if settings.env not in ("development", "test"):
        raise ApiError(
            501,
            ErrorCode.AUTH_NOT_CONFIGURED,
            "Authentication is not configured; the development user is disabled in production.",
        )
    user = await session.get(User, DEV_USER_ID)
    if user is None:
        raise ApiError(
            503,
            ErrorCode.DEV_USER_MISSING,
            f"Development user is missing. Run: {SEED_COMMAND}",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
