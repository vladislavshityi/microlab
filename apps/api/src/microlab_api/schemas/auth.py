"""Модели API аутентификации, групп и администрирования пользователей."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, Field, StringConstraints

from microlab_api.schemas.base import ApiModel


def _normalize_email(value: str) -> str:
    value = value.strip().lower()
    local, sep, domain = value.partition("@")
    if not sep or not local or "." not in domain or any(ch.isspace() for ch in value):
        raise ValueError("Invalid email address.")
    return value


type Email = Annotated[str, StringConstraints(max_length=254), AfterValidator(_normalize_email)]
type DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
# Длина проверяется политикой паролей (WEAK_PASSWORD), здесь — только грубый предел.
type Password = Annotated[str, StringConstraints(max_length=1024)]
type GroupName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
type Role = Literal["student", "teacher", "admin"]


class UserInfo(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    must_change_password: bool


class LoginRequest(ApiModel):
    email: Annotated[str, StringConstraints(max_length=254)]
    password: Password


class RegisterRequest(ApiModel):
    invite_code: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)]
    email: Email
    display_name: DisplayName
    password: Password


class ChangePasswordRequest(ApiModel):
    current_password: Password
    new_password: Password


class JoinGroupRequest(ApiModel):
    invite_code: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)]


# --- Группы ---


class UserRef(ApiModel):
    id: uuid.UUID
    display_name: str


class GroupSummary(ApiModel):
    id: uuid.UUID
    name: str
    teacher: UserRef
    member_count: int
    created_at: datetime


class GroupList(ApiModel):
    items: list[GroupSummary]


class GroupCreate(ApiModel):
    name: GroupName
    teacher_id: uuid.UUID | None = Field(
        default=None, description="Admin only: owner teacher (defaults to the caller)."
    )


class GroupUpdate(ApiModel):
    name: GroupName


class GroupMemberInfo(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    joined_at: datetime


class GroupMemberList(ApiModel):
    items: list[GroupMemberInfo]


class InviteInfo(ApiModel):
    id: uuid.UUID
    code: str
    expires_at: datetime | None
    max_uses: int | None
    uses: int
    revoked: bool
    active: bool = Field(description="Not revoked, not expired and uses left.")
    created_at: datetime


class InviteList(ApiModel):
    items: list[InviteInfo]


class InviteCreate(ApiModel):
    expires_in_hours: float | None = Field(default=168, gt=0, le=24 * 365)
    max_uses: int | None = Field(default=None, ge=1, le=10_000)


class GroupProjectSummary(ApiModel):
    id: uuid.UUID
    name: str
    owner: UserRef
    revision: int
    updated_at: datetime


class GroupProjectList(ApiModel):
    items: list[GroupProjectSummary]


# --- Администрирование ---


class AdminUserInfo(ApiModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    is_active: bool
    must_change_password: bool
    created_at: datetime
    last_login_at: datetime | None


class AdminUserList(ApiModel):
    items: list[AdminUserInfo]
    total: int


class AdminUserCreate(ApiModel):
    email: Email
    display_name: DisplayName
    role: Role
    password: Password | None = Field(
        default=None,
        description="Omit to generate a temporary password (returned once; must be changed).",
    )


class AdminUserUpdate(ApiModel):
    display_name: DisplayName | None = None
    role: Role | None = None
    is_active: bool | None = None


class AdminUserCreated(ApiModel):
    user: AdminUserInfo
    temporary_password: str | None = Field(description="Shown only once.")


class TemporaryPassword(ApiModel):
    temporary_password: str
