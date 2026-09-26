"""Администрирование пользователей: создание, роли, сброс пароля, отключение.

Администратор не может снять с себя роль администратора или отключить себя — это
защищает от потери доступа к системе. Отключение и сброс пароля завершают все сессии
пользователя.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.current_user import AdminUser
from microlab_api.api.errors import ApiError
from microlab_api.auth import passwords
from microlab_api.auth.sessions import delete_user_sessions
from microlab_api.db.database import get_session
from microlab_api.models import User, UserRole
from microlab_api.schemas.auth import (
    AdminUserCreate,
    AdminUserCreated,
    AdminUserInfo,
    AdminUserList,
    AdminUserUpdate,
    Role,
    TemporaryPassword,
)
from microlab_api.schemas.errors import ErrorCode, ErrorResponse

router = APIRouter(prefix="/admin/users", tags=["admin"])

Session = Annotated[AsyncSession, Depends(get_session)]


def _error(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}


_COMMON: dict[int | str, dict[str, Any]] = {
    401: _error("Not logged in (AUTH_REQUIRED)."),
    403: _error("Admins only (FORBIDDEN), CSRF_FAILED or PASSWORD_CHANGE_REQUIRED."),
    500: _error("Unexpected server error."),
    503: _error("Database is unavailable."),
}
_USER: dict[int | str, dict[str, Any]] = {**_COMMON, 404: _error("USER_NOT_FOUND.")}


def admin_user_info(user: User) -> AdminUserInfo:
    return AdminUserInfo(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role.value,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


async def _get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise ApiError(404, ErrorCode.USER_NOT_FOUND, "User not found.")
    return user


@router.get(
    "",
    response_model=AdminUserList,
    responses=_COMMON,
    summary="List users (search by email or name, filter by role)",
    operation_id="listUsers",
)
async def list_users(
    _admin: AdminUser,
    db: Session,
    q: Annotated[str | None, Query(max_length=100)] = None,
    role: Role | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> AdminUserList:
    conditions = []
    if q:
        # Спецсимволы LIKE экранируются: поиск — по подстроке, а не по шаблону.
        escaped = q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        conditions.append(
            or_(
                User.email.like(pattern, escape="\\"),
                func.lower(User.display_name).like(pattern, escape="\\"),
            )
        )
    if role is not None:
        conditions.append(User.role == UserRole(role))
    total = await db.scalar(select(func.count()).select_from(User).where(*conditions)) or 0
    users = await db.scalars(
        select(User)
        .where(*conditions)
        .order_by(User.created_at.desc(), User.id)
        .offset(offset)
        .limit(limit)
    )
    return AdminUserList(items=[admin_user_info(user) for user in users], total=total)


@router.post(
    "",
    status_code=201,
    response_model=AdminUserCreated,
    responses={
        **_COMMON,
        409: _error("Email is already registered (EMAIL_TAKEN)."),
        422: _error("Invalid request (VALIDATION_ERROR) or weak password (WEAK_PASSWORD)."),
    },
    summary="Create a user (temporary password if none is given)",
    operation_id="createUser",
)
async def create_user(body: AdminUserCreate, _admin: AdminUser, db: Session) -> AdminUserCreated:
    temporary = body.password is None
    password = passwords.generate_temporary_password() if body.password is None else body.password
    if not temporary:
        passwords.check_password_policy(password, body.email)
    user = User(
        email=body.email,
        display_name=body.display_name,
        role=UserRole(body.role),
        password_hash=await passwords.hash_password_async(password),
        is_active=True,
        must_change_password=temporary,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, ErrorCode.EMAIL_TAKEN, "Email is already registered.") from None
    await db.refresh(user)
    await db.commit()
    return AdminUserCreated(
        user=admin_user_info(user), temporary_password=password if temporary else None
    )


@router.patch(
    "/{user_id}",
    response_model=AdminUserInfo,
    responses={**_USER, 422: _error("Cannot demote or deactivate yourself (VALIDATION_ERROR).")},
    summary="Change a user's name, role or active state",
    operation_id="updateUser",
)
async def update_user(
    user_id: uuid.UUID, body: AdminUserUpdate, admin: AdminUser, db: Session
) -> AdminUserInfo:
    user = await _get_user(db, user_id)
    if user.id == admin.id and (
        (body.role is not None and body.role != UserRole.ADMIN.value) or body.is_active is False
    ):
        raise ApiError(
            422, ErrorCode.VALIDATION_ERROR, "Admins cannot demote or deactivate themselves."
        )
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = UserRole(body.role)
    if body.is_active is not None:
        user.is_active = body.is_active
        if not body.is_active:
            await delete_user_sessions(db, user.id)
    await db.commit()
    return admin_user_info(user)


@router.post(
    "/{user_id}/reset-password",
    response_model=TemporaryPassword,
    responses=_USER,
    summary="Reset a password to a temporary one (shown once; must be changed at next login)",
    operation_id="resetUserPassword",
)
async def reset_password(user_id: uuid.UUID, _admin: AdminUser, db: Session) -> TemporaryPassword:
    user = await _get_user(db, user_id)
    temporary = passwords.generate_temporary_password()
    user.password_hash = await passwords.hash_password_async(temporary)
    user.must_change_password = True
    await delete_user_sessions(db, user.id)
    await db.commit()
    return TemporaryPassword(temporary_password=temporary)
