"""Учебные группы: преподаватель управляет своими группами, администратор — всеми.

Студент видит список групп, в которых состоит, и может вступить в группу по коду
приглашения. Чужая группа для преподавателя неотличима от несуществующей (404 GROUP_NOT_FOUND).
"""

import uuid
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.current_user import CurrentUser, StaffUser
from microlab_api.api.errors import ApiError
from microlab_api.auth.sessions import now_utc
from microlab_api.db.database import get_session
from microlab_api.models import Group, GroupMember, InviteCode, Project, User, UserRole
from microlab_api.schemas.auth import (
    GroupCreate,
    GroupList,
    GroupMemberInfo,
    GroupMemberList,
    GroupProjectList,
    GroupProjectSummary,
    GroupSummary,
    GroupUpdate,
    InviteCreate,
    InviteInfo,
    InviteList,
    JoinGroupRequest,
    UserRef,
)
from microlab_api.schemas.errors import ErrorCode, ErrorResponse
from microlab_api.services import group_service

router = APIRouter(prefix="/groups", tags=["groups"])

Session = Annotated[AsyncSession, Depends(get_session)]


def _error(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}


_COMMON: dict[int | str, dict[str, Any]] = {
    401: _error("Not logged in (AUTH_REQUIRED)."),
    403: _error("Insufficient role (FORBIDDEN), CSRF_FAILED or PASSWORD_CHANGE_REQUIRED."),
    500: _error("Unexpected server error."),
    503: _error("Database is unavailable."),
}
_GROUP: dict[int | str, dict[str, Any]] = {
    **_COMMON,
    404: _error("Group not found (GROUP_NOT_FOUND)."),
}


async def _summaries(db: AsyncSession, groups: list[Group]) -> list[GroupSummary]:
    counts = await group_service.member_counts(db, [group.id for group in groups])
    teacher_ids = {group.teacher_id for group in groups}
    teachers = (
        {user.id: user for user in await db.scalars(select(User).where(User.id.in_(teacher_ids)))}
        if teacher_ids
        else {}
    )
    return [
        GroupSummary(
            id=group.id,
            name=group.name,
            teacher=UserRef(
                id=group.teacher_id, display_name=teachers[group.teacher_id].display_name
            ),
            member_count=counts.get(group.id, 0),
            created_at=group.created_at,
        )
        for group in groups
    ]


def _invite_info(invite: InviteCode) -> InviteInfo:
    return InviteInfo(
        id=invite.id,
        code=invite.code,
        expires_at=invite.expires_at,
        max_uses=invite.max_uses,
        uses=invite.uses,
        revoked=invite.revoked,
        active=group_service.invite_active(invite),
        created_at=invite.created_at,
    )


@router.get(
    "",
    response_model=GroupList,
    responses=_COMMON,
    summary="Groups visible to the user (teacher: own, admin: all, student: joined)",
    operation_id="listGroups",
)
async def list_groups(user: CurrentUser, db: Session) -> GroupList:
    stmt = select(Group).order_by(Group.created_at.desc(), Group.id)
    if user.role is UserRole.TEACHER:
        stmt = stmt.where(Group.teacher_id == user.id)
    elif user.role is UserRole.STUDENT:
        stmt = stmt.join(GroupMember, GroupMember.group_id == Group.id).where(
            GroupMember.user_id == user.id
        )
    groups = list(await db.scalars(stmt))
    return GroupList(items=await _summaries(db, groups))


@router.post(
    "",
    status_code=201,
    response_model=GroupSummary,
    responses={**_COMMON, 422: _error("Invalid request or teacherId is not a teacher.")},
    summary="Create a group",
    operation_id="createGroup",
)
async def create_group(body: GroupCreate, user: StaffUser, db: Session) -> GroupSummary:
    teacher_id = user.id
    if body.teacher_id is not None and body.teacher_id != user.id:
        if user.role is not UserRole.ADMIN:
            raise ApiError(403, ErrorCode.FORBIDDEN, "Only admins may assign another teacher.")
        teacher = await db.get(User, body.teacher_id)
        if teacher is None or teacher.role is UserRole.STUDENT:
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, "teacherId must be a teacher or admin.")
        teacher_id = teacher.id
    group = Group(name=body.name, teacher_id=teacher_id)
    db.add(group)
    await db.flush()
    await db.refresh(group)
    await db.commit()
    return (await _summaries(db, [group]))[0]


@router.post(
    "/join",
    response_model=GroupSummary,
    responses={
        **_COMMON,
        400: _error("Invite code is invalid, revoked, expired or used up (INVALID_INVITE_CODE)."),
    },
    summary="Join a group with an invite code (students)",
    operation_id="joinGroup",
)
async def join_group(body: JoinGroupRequest, user: CurrentUser, db: Session) -> GroupSummary:
    if user.role is not UserRole.STUDENT:
        raise ApiError(403, ErrorCode.FORBIDDEN, "Only students join groups.")
    group = await group_service.consume_invite(db, body.invite_code)
    await group_service.add_member(db, group, user)
    await db.commit()
    return (await _summaries(db, [group]))[0]


@router.get(
    "/{group_id}",
    response_model=GroupSummary,
    responses=_GROUP,
    summary="Get a managed group",
    operation_id="getGroup",
)
async def get_group(group_id: uuid.UUID, user: StaffUser, db: Session) -> GroupSummary:
    group = await group_service.get_managed_group(db, user, group_id)
    return (await _summaries(db, [group]))[0]


@router.patch(
    "/{group_id}",
    response_model=GroupSummary,
    responses=_GROUP,
    summary="Rename a group",
    operation_id="updateGroup",
)
async def update_group(
    group_id: uuid.UUID, body: GroupUpdate, user: StaffUser, db: Session
) -> GroupSummary:
    group = await group_service.get_managed_group(db, user, group_id)
    group.name = body.name
    await db.commit()
    return (await _summaries(db, [group]))[0]


@router.delete(
    "/{group_id}",
    status_code=204,
    response_class=Response,
    responses=_GROUP,
    summary="Delete a group (members' accounts and projects are kept)",
    operation_id="deleteGroup",
)
async def delete_group(group_id: uuid.UUID, user: StaffUser, db: Session) -> Response:
    group = await group_service.get_managed_group(db, user, group_id)
    await db.delete(group)
    await db.commit()
    return Response(status_code=204)


@router.get(
    "/{group_id}/members",
    response_model=GroupMemberList,
    responses=_GROUP,
    summary="List group members",
    operation_id="listGroupMembers",
)
async def list_members(group_id: uuid.UUID, user: StaffUser, db: Session) -> GroupMemberList:
    await group_service.get_managed_group(db, user, group_id)
    rows = await db.execute(
        select(User, GroupMember.joined_at)
        .join(GroupMember, GroupMember.user_id == User.id)
        .where(GroupMember.group_id == group_id)
        .order_by(User.display_name, User.id)
    )
    return GroupMemberList(
        items=[
            GroupMemberInfo(
                id=member.id,
                email=member.email,
                display_name=member.display_name,
                joined_at=joined_at,
            )
            for member, joined_at in rows
        ]
    )


@router.delete(
    "/{group_id}/members/{user_id}",
    status_code=204,
    response_class=Response,
    responses={**_GROUP, 404: _error("GROUP_NOT_FOUND or USER_NOT_FOUND.")},
    summary="Remove a member from a group",
    operation_id="removeGroupMember",
)
async def remove_member(
    group_id: uuid.UUID, user_id: uuid.UUID, user: StaffUser, db: Session
) -> Response:
    await group_service.get_managed_group(db, user, group_id)
    result = await db.execute(
        delete(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
    )
    if getattr(result, "rowcount", 0) == 0:
        raise ApiError(404, ErrorCode.USER_NOT_FOUND, "User is not a member of the group.")
    await db.commit()
    return Response(status_code=204)


@router.get(
    "/{group_id}/invites",
    response_model=InviteList,
    responses=_GROUP,
    summary="List invite codes of a group (newest first)",
    operation_id="listGroupInvites",
)
async def list_invites(group_id: uuid.UUID, user: StaffUser, db: Session) -> InviteList:
    await group_service.get_managed_group(db, user, group_id)
    invites = await db.scalars(
        select(InviteCode)
        .where(InviteCode.group_id == group_id)
        .order_by(InviteCode.created_at.desc(), InviteCode.id)
    )
    return InviteList(items=[_invite_info(invite) for invite in invites])


@router.post(
    "/{group_id}/invites",
    status_code=201,
    response_model=InviteInfo,
    responses=_GROUP,
    summary="Create an invite code (expiry and max uses optional)",
    operation_id="createGroupInvite",
)
async def create_invite(
    group_id: uuid.UUID, body: InviteCreate, user: StaffUser, db: Session
) -> InviteInfo:
    await group_service.get_managed_group(db, user, group_id)
    expires_at = (
        None
        if body.expires_in_hours is None
        else now_utc() + timedelta(hours=body.expires_in_hours)
    )
    for _attempt in range(5):
        invite = InviteCode(
            code=group_service.generate_invite_code(),
            group_id=group_id,
            expires_at=expires_at,
            max_uses=body.max_uses,
            uses=0,
            revoked=False,
        )
        db.add(invite)
        try:
            await db.flush()
        except IntegrityError:  # pragma: no cover - совпадение 59-битных кодов
            await db.rollback()
            continue
        await db.refresh(invite)
        await db.commit()
        return _invite_info(invite)
    raise ApiError(500, ErrorCode.INTERNAL_ERROR, "Could not generate an invite code.")


@router.post(
    "/{group_id}/invites/{invite_id}/revoke",
    response_model=InviteInfo,
    responses={**_GROUP, 404: _error("GROUP_NOT_FOUND or INVITE_NOT_FOUND.")},
    summary="Revoke an invite code",
    operation_id="revokeGroupInvite",
)
async def revoke_invite(
    group_id: uuid.UUID, invite_id: uuid.UUID, user: StaffUser, db: Session
) -> InviteInfo:
    await group_service.get_managed_group(db, user, group_id)
    invite = await db.get(InviteCode, invite_id)
    if invite is None or invite.group_id != group_id:
        raise ApiError(404, ErrorCode.INVITE_NOT_FOUND, "Invite code not found.")
    invite.revoked = True
    await db.commit()
    return _invite_info(invite)


@router.get(
    "/{group_id}/projects",
    response_model=GroupProjectList,
    responses=_GROUP,
    summary="Projects of the group's members (most recently updated first)",
    operation_id="listGroupProjects",
)
async def list_group_projects(
    group_id: uuid.UUID, user: StaffUser, db: Session
) -> GroupProjectList:
    await group_service.get_managed_group(db, user, group_id)
    rows = await db.execute(
        select(Project, User)
        .join(User, User.id == Project.owner_id)
        .join(GroupMember, GroupMember.user_id == User.id)
        .where(GroupMember.group_id == group_id)
        .order_by(Project.updated_at.desc(), Project.id)
    )
    return GroupProjectList(
        items=[
            GroupProjectSummary(
                id=project.id,
                name=project.name,
                owner=UserRef(id=owner.id, display_name=owner.display_name),
                revision=project.revision,
                updated_at=project.updated_at,
            )
            for project, owner in rows
        ]
    )
