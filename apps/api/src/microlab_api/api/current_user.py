"""Текущий пользователь запроса (cookie сессии) и защита от CSRF.

- ``AuthenticatedUser`` — любой вошедший пользователь (в том числе обязанный сменить пароль);
- ``CurrentUser`` — вошедший пользователь, которому не нужно сменить пароль;
- ``require_roles(...)`` — дополнительно проверяет роль (403 FORBIDDEN).

Защита от CSRF (``csrf_protect``, подключается ко всем маршрутам API): изменяющий запрос
должен нести заголовок ``X-MicroLab-Request: 1`` — браузер не отправит его с чужого сайта
без CORS preflight, а CORS API не разрешает. Если браузер передал ``Origin``, он должен
совпадать с хостом запроса или быть в ``MICROLAB_ALLOWED_ORIGINS`` — та же проверка, что
и при подключении WebSocket. Cookie сессии дополнительно имеет SameSite=Lax.
"""

from collections.abc import Awaitable, Callable, Mapping
from typing import Annotated, Final
from urllib.parse import urlsplit

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.errors import ApiError
from microlab_api.auth.sessions import SESSION_COOKIE, resolve_session
from microlab_api.config import Settings
from microlab_api.db.database import get_session
from microlab_api.models import AuthSession, User, UserRole
from microlab_api.schemas.errors import ErrorCode

CSRF_HEADER: Final = "X-MicroLab-Request"
_SAFE_METHODS: Final = frozenset({"GET", "HEAD", "OPTIONS"})


def origin_allowed(headers: Mapping[str, str], settings: Settings) -> bool:
    """Origin отсутствует (не браузер) или совпадает с хостом либо разрешённым списком."""
    origin = headers.get("origin")
    if origin is None:
        return True
    if origin.rstrip("/") in {item.rstrip("/") for item in settings.allowed_origins}:
        return True
    host = headers.get("host")
    return host is not None and urlsplit(origin).netloc == host


async def csrf_protect(request: Request) -> None:
    if request.method in _SAFE_METHODS:
        return
    settings: Settings = request.app.state.settings
    if request.headers.get(CSRF_HEADER) != "1" or not origin_allowed(request.headers, settings):
        raise ApiError(403, ErrorCode.CSRF_FAILED, "Cross-site request rejected.")


def _auth_required() -> ApiError:
    return ApiError(401, ErrorCode.AUTH_REQUIRED, "Authentication required.")


async def get_authentication(
    request: Request, db: Annotated[AsyncSession, Depends(get_session)]
) -> tuple[AuthSession, User]:
    token = request.cookies.get(SESSION_COOKIE)
    if token is None:
        raise _auth_required()
    resolved = await resolve_session(db, request.app.state.settings, token)
    if resolved is None:
        raise _auth_required()
    return resolved


Authentication = Annotated[tuple[AuthSession, User], Depends(get_authentication)]


async def get_authenticated_user(auth: Authentication) -> User:
    return auth[1]


async def get_current_user(auth: Authentication) -> User:
    user = auth[1]
    if user.must_change_password:
        raise ApiError(403, ErrorCode.PASSWORD_CHANGE_REQUIRED, "Password change required.")
    return user


AuthenticatedUser = Annotated[User, Depends(get_authenticated_user)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[User], Awaitable[User]]:
    async def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise ApiError(403, ErrorCode.FORBIDDEN, "Insufficient permissions.")
        return user

    return dependency


StaffUser = Annotated[User, Depends(require_roles(UserRole.TEACHER, UserRole.ADMIN))]
AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
