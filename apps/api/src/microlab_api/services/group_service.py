"""Группы, участники и коды приглашения."""

import secrets
import uuid
from datetime import datetime
from typing import Final

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.errors import ApiError
from microlab_api.auth.sessions import now_utc
from microlab_api.models import Group, GroupMember, InviteCode, User, UserRole
from microlab_api.schemas.errors import ErrorCode

# Без похожих символов (0/O, 1/I/L); 31 символ × 12 позиций ≈ 59 бит.
INVITE_ALPHABET: Final = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
INVITE_LENGTH: Final = 12


def generate_invite_code() -> str:
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LENGTH))


def normalize_invite_code(raw: str) -> str:
    return "".join(ch for ch in raw.upper() if ch not in " -\t")


def invite_active(invite: InviteCode, now: datetime | None = None) -> bool:
    now = now or now_utc()
    return (
        not invite.revoked
        and (invite.expires_at is None or invite.expires_at > now)
        and (invite.max_uses is None or invite.uses < invite.max_uses)
    )


def _group_not_found() -> ApiError:
    return ApiError(404, ErrorCode.GROUP_NOT_FOUND, "Group not found.")


async def get_managed_group(db: AsyncSession, user: User, group_id: uuid.UUID) -> Group:
    """Группа, которой управляет пользователь (преподаватель-владелец или администратор)."""
    group = await db.get(Group, group_id)
    if group is None or (user.role is not UserRole.ADMIN and group.teacher_id != user.id):
        raise _group_not_found()
    return group


async def consume_invite(db: AsyncSession, raw_code: str) -> Group:
    """Засчитывает использование кода (строка блокируется) и возвращает группу.

    Любой неподходящий код (нет, отозван, истёк, исчерпан) — одна ошибка без подробностей.
    """
    code = normalize_invite_code(raw_code)
    invite = (
        await db.scalar(select(InviteCode).where(InviteCode.code == code).with_for_update())
        if code
        else None
    )
    if invite is None or not invite_active(invite):
        raise ApiError(400, ErrorCode.INVALID_INVITE_CODE, "Invite code is invalid or expired.")
    invite.uses += 1
    group = await db.get(Group, invite.group_id)
    if group is None:  # pragma: no cover - внешний ключ гарантирует наличие группы
        raise _group_not_found()
    return group


async def add_member(db: AsyncSession, group: Group, user: User) -> None:
    await db.execute(
        insert(GroupMember)
        .values(group_id=group.id, user_id=user.id)
        .on_conflict_do_nothing(index_elements=["group_id", "user_id"])
    )


async def teaches(db: AsyncSession, teacher_id: uuid.UUID, student_id: uuid.UUID) -> bool:
    """Пользователь ``student_id`` состоит в группе преподавателя ``teacher_id``."""
    stmt = select(
        exists().where(
            GroupMember.user_id == student_id,
            GroupMember.group_id == Group.id,
            Group.teacher_id == teacher_id,
        )
    )
    return bool(await db.scalar(stmt))


async def member_counts(db: AsyncSession, group_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not group_ids:
        return {}
    rows = await db.execute(
        select(GroupMember.group_id, func.count())
        .where(GroupMember.group_id.in_(group_ids))
        .group_by(GroupMember.group_id)
    )
    return {group_id: count for group_id, count in rows}
