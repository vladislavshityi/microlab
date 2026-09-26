"""Вход, регистрация по коду приглашения, выход и смена пароля.

Ошибки входа не различают неизвестный адрес, неверный пароль и отключённую учётную запись
(401 INVALID_CREDENTIALS). Неудачные попытки ограничены по IP и по адресу (429 RATE_LIMITED).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.current_user import AuthenticatedUser, Authentication
from microlab_api.api.errors import ApiError
from microlab_api.auth import passwords
from microlab_api.auth.rate_limit import RateLimits, raise_if_limited
from microlab_api.auth.sessions import (
    SESSION_COOKIE,
    create_session,
    delete_session,
    delete_user_sessions,
    now_utc,
)
from microlab_api.config import Settings
from microlab_api.db.database import get_session
from microlab_api.models import User, UserRole
from microlab_api.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    UserInfo,
)
from microlab_api.schemas.errors import ErrorCode, ErrorDetail, ErrorResponse
from microlab_api.services import group_service

router = APIRouter(prefix="/auth", tags=["auth"])

Session = Annotated[AsyncSession, Depends(get_session)]


def _error(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}


_COMMON: dict[int | str, dict[str, Any]] = {
    403: _error("Cross-site request rejected (CSRF_FAILED)."),
    500: _error("Unexpected server error."),
    503: _error("Database is unavailable."),
}


def user_info(user: User) -> UserInfo:
    return UserInfo(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role.value,
        must_change_password=user.must_change_password,
    )


def client_ip(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


def _limits(request: Request) -> RateLimits:
    limits: RateLimits = request.app.state.rate_limits
    return limits


async def _start_session(
    request: Request, response: Response, db: AsyncSession, user: User
) -> None:
    settings: Settings = request.app.state.settings
    token = await create_session(
        db,
        settings,
        user,
        user_agent=request.headers.get("user-agent"),
        ip=client_ip(request),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(settings.session_absolute_timeout_hours * 3600),
        path="/",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )


def _clear_cookie(request: Request, response: Response) -> None:
    settings: Settings = request.app.state.settings
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, secure=settings.cookie_secure, samesite="lax"
    )


@router.post(
    "/login",
    response_model=UserInfo,
    responses={
        **_COMMON,
        401: _error("Wrong email or password (INVALID_CREDENTIALS)."),
        429: _error("Too many failed attempts (RATE_LIMITED)."),
    },
    summary="Log in with email and password (sets the session cookie)",
    operation_id="login",
)
async def login(body: LoginRequest, request: Request, response: Response, db: Session) -> UserInfo:
    limits = _limits(request)
    ip = client_ip(request)
    email = body.email.strip().lower()
    raise_if_limited(limits.login_ip.retry_after(ip), limits.login_account.retry_after(email))

    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        passwords.verify_unknown_user(body.password)
        ok = False
    else:
        ok = passwords.verify_password(user.password_hash, body.password) and user.is_active
    if user is None or not ok:
        limits.login_ip.hit(ip)
        limits.login_account.hit(email)
        raise ApiError(401, ErrorCode.INVALID_CREDENTIALS, "Invalid email or password.")

    limits.login_account.reset(email)
    if user.password_hash is not None and passwords.needs_rehash(user.password_hash):
        user.password_hash = passwords.hash_password(body.password)
    user.last_login_at = now_utc()
    await _start_session(request, response, db, user)
    await db.commit()
    return user_info(user)


@router.post(
    "/register",
    status_code=201,
    response_model=UserInfo,
    responses={
        **_COMMON,
        400: _error("Invite code is invalid, revoked, expired or used up (INVALID_INVITE_CODE)."),
        409: _error("Email is already registered (EMAIL_TAKEN)."),
        422: _error("Invalid request (VALIDATION_ERROR) or weak password (WEAK_PASSWORD)."),
        429: _error("Too many failed attempts (RATE_LIMITED)."),
    },
    summary="Register a student account with a group invite code",
    operation_id="register",
)
async def register(
    body: RegisterRequest, request: Request, response: Response, db: Session
) -> UserInfo:
    limits = _limits(request)
    ip = client_ip(request)
    raise_if_limited(limits.login_ip.retry_after(ip))
    passwords.check_password_policy(body.password, body.email)
    try:
        group = await group_service.consume_invite(db, body.invite_code)
    except ApiError:
        # Перебор кодов приглашения ограничивается так же, как перебор паролей.
        limits.login_ip.hit(ip)
        raise
    taken = await db.scalar(select(func.count()).select_from(User).where(User.email == body.email))
    if taken:
        await db.rollback()
        raise ApiError(409, ErrorCode.EMAIL_TAKEN, "Email is already registered.")
    user = User(
        email=body.email,
        display_name=body.display_name,
        password_hash=passwords.hash_password(body.password),
        role=UserRole.STUDENT,
        is_active=True,
        must_change_password=False,
        last_login_at=now_utc(),
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # Параллельная регистрация с тем же адресом.
        await db.rollback()
        raise ApiError(409, ErrorCode.EMAIL_TAKEN, "Email is already registered.") from None
    await group_service.add_member(db, group, user)
    await _start_session(request, response, db, user)
    await db.commit()
    return user_info(user)


@router.post(
    "/logout",
    status_code=204,
    response_class=Response,
    responses=_COMMON,
    summary="End the current session",
    operation_id="logout",
)
async def logout(request: Request, db: Session) -> Response:
    response = Response(status_code=204)
    token = request.cookies.get(SESSION_COOKIE)
    if token is not None:
        await delete_session(db, token)
        await db.commit()
    _clear_cookie(request, response)
    return response


@router.post(
    "/logout-all",
    status_code=204,
    response_class=Response,
    responses={**_COMMON, 401: _error("Not logged in (AUTH_REQUIRED).")},
    summary="End all sessions of the current user",
    operation_id="logoutAll",
)
async def logout_all(request: Request, user: AuthenticatedUser, db: Session) -> Response:
    await delete_user_sessions(db, user.id)
    await db.commit()
    response = Response(status_code=204)
    _clear_cookie(request, response)
    return response


@router.get(
    "/me",
    response_model=UserInfo,
    responses={**_COMMON, 401: _error("Not logged in (AUTH_REQUIRED).")},
    summary="Current user",
    operation_id="getCurrentUser",
)
async def me(user: AuthenticatedUser) -> UserInfo:
    return user_info(user)


@router.post(
    "/change-password",
    response_model=UserInfo,
    responses={
        **_COMMON,
        401: _error(
            "Not logged in (AUTH_REQUIRED) or wrong current password (INVALID_CREDENTIALS)."
        ),
        422: _error("Weak password (WEAK_PASSWORD)."),
        429: _error("Too many failed attempts (RATE_LIMITED)."),
    },
    summary="Change the password; other sessions of the user are ended",
    operation_id="changePassword",
)
async def change_password(
    body: ChangePasswordRequest, request: Request, auth: Authentication, db: Session
) -> UserInfo:
    auth_session, user = auth
    limits = _limits(request)
    raise_if_limited(limits.login_account.retry_after(user.email))
    if not passwords.verify_password(user.password_hash, body.current_password):
        limits.login_account.hit(user.email)
        raise ApiError(
            401,
            ErrorCode.INVALID_CREDENTIALS,
            "Current password is incorrect.",
            [ErrorDetail(field="currentPassword", message="Incorrect.", code="incorrect")],
        )
    passwords.check_password_policy(body.new_password, user.email, field="newPassword")
    if body.new_password == body.current_password:
        raise ApiError(
            422,
            ErrorCode.WEAK_PASSWORD,
            "Password does not meet the policy.",
            [
                ErrorDetail(
                    field="newPassword",
                    message="New password must differ from the current one.",
                    code="unchanged",
                )
            ],
        )
    user.password_hash = passwords.hash_password(body.new_password)
    user.must_change_password = False
    await delete_user_sessions(db, user.id, except_id=auth_session.id)
    await db.commit()
    return user_info(user)
