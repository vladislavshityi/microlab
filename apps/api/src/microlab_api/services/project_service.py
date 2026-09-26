"""Проекты пользователя: создание, чтение, изменение с оптимистичной блокировкой, история.

Каждое изменение проекта увеличивает ``projects.revision``. Изменение кода или схемы
дополнительно сохраняет снимок в ``project_revisions`` с тем же номером; хранятся только
последние :data:`MAX_STORED_REVISIONS` снимков. Номера снимков поэтому могут идти с
пропусками (например, после переименования проекта).
"""

import json
import uuid
from typing import Any, Final

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.errors import ApiError
from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.domain.circuit import (
    SUPPORTED_SCHEMA_VERSION,
    Issue,
    RefKind,
    Severity,
    check_references,
    parse_circuit,
)
from microlab_api.models import Project, ProjectRevision, User, UserRole
from microlab_api.schemas.errors import ErrorCode, ErrorDetail
from microlab_api.schemas.projects import ProjectCreate, ProjectUpdate
from microlab_api.services import group_service
from microlab_api.services.compiler_service import MAX_SOURCE_BYTES

MAX_STORED_REVISIONS: Final = 50
# Предел размера документа схемы в JSON; с запасом больше схем учебного масштаба.
MAX_CIRCUIT_BYTES: Final = 2 * 1024 * 1024
DEFAULT_SKETCH: Final = "void setup() {\n}\n\nvoid loop() {\n}\n"
DEFAULT_BOARD_ID: Final = "uno1"


def empty_circuit(board: str) -> dict[str, Any]:
    return {
        "schemaVersion": SUPPORTED_SCHEMA_VERSION,
        "board": {"id": DEFAULT_BOARD_ID, "type": board},
        "components": [],
        "connections": [],
    }


def issue_detail(issue: Issue) -> ErrorDetail:
    ref = issue.refs[0] if issue.refs else None
    if ref is None:
        field = "circuit"
    elif ref.kind is RefKind.FIELD:
        field = f"circuit.{ref.id}"
    else:
        field = f"circuit:{ref.kind.value}:{ref.id}"
    return ErrorDetail(field=field, message=issue.message, code=issue.code.value)


def _invalid_circuit(details: list[ErrorDetail]) -> ApiError:
    return ApiError(422, ErrorCode.INVALID_CIRCUIT, "Circuit document is invalid.", details)


def check_circuit(raw: dict[str, Any], board: str) -> dict[str, Any]:
    """Проверяет структуру документа и ссылки на определения компонентов.

    Электрические замечания (даже уровня ERROR) сохранению не мешают: схема в процессе
    сборки может быть электрически неверной. Отклоняется только документ, который
    нельзя однозначно понять.
    """
    if len(json.dumps(raw, ensure_ascii=False).encode("utf-8")) > MAX_CIRCUIT_BYTES:
        raise _invalid_circuit(
            [
                ErrorDetail(
                    field="circuit", message="Circuit document is too large.", code="TOO_LARGE"
                )
            ]
        )
    parsed = parse_circuit(raw)
    if parsed.document is None:
        raise _invalid_circuit([issue_detail(issue) for issue in parsed.issues])
    errors = [
        issue
        for issue in check_references(parsed.document, get_definition_registry())
        if issue.severity is Severity.ERROR
    ]
    details = [issue_detail(issue) for issue in errors]
    if parsed.document.board.type != board:
        details.append(
            ErrorDetail(
                field="circuit.board.type",
                message=f"Circuit board {parsed.document.board.type!r} does not match project "
                f"board {board!r}.",
                code="BOARD_MISMATCH",
            )
        )
    if details:
        raise _invalid_circuit(details)
    return raw


def _check_code(code: str) -> str:
    if len(code.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise ApiError(413, ErrorCode.SOURCE_TOO_LARGE, "Source is too large.")
    return code


def _not_found() -> ApiError:
    return ApiError(404, ErrorCode.PROJECT_NOT_FOUND, "Project not found.")


def _snapshot(project: Project) -> ProjectRevision:
    return ProjectRevision(
        project_id=project.id,
        revision=project.revision,
        code=project.code,
        circuit=project.circuit,
        schema_version=project.schema_version,
    )


async def _prune_revisions(session: AsyncSession, project_id: uuid.UUID) -> None:
    keep = (
        select(ProjectRevision.revision)
        .where(ProjectRevision.project_id == project_id)
        .order_by(ProjectRevision.revision.desc())
        .limit(MAX_STORED_REVISIONS)
    )
    await session.execute(
        delete(ProjectRevision).where(
            ProjectRevision.project_id == project_id, ProjectRevision.revision.not_in(keep)
        )
    )


async def list_projects(session: AsyncSession, owner: User) -> list[Project]:
    result = await session.scalars(
        select(Project)
        .where(Project.owner_id == owner.id)
        .order_by(Project.updated_at.desc(), Project.id)
    )
    return list(result)


async def get_project(
    session: AsyncSession, owner: User, project_id: uuid.UUID, *, for_update: bool = False
) -> Project:
    """Проект владельца; чужой или несуществующий — PROJECT_NOT_FOUND (без утечки факта)."""
    stmt = select(Project).where(Project.id == project_id, Project.owner_id == owner.id)
    if for_update:
        stmt = stmt.with_for_update()
    project = await session.scalar(stmt)
    if project is None:
        raise _not_found()
    return project


async def get_readable_project(
    session: AsyncSession, user: User, project_id: uuid.UUID
) -> tuple[Project, User]:
    """Проект и его владелец, если пользователь может его читать.

    Читать можно свои проекты; преподаватель — проекты студентов своих групп;
    администратор — любые. Остальные — PROJECT_NOT_FOUND.
    """
    row = (
        await session.execute(
            select(Project, User)
            .join(User, User.id == Project.owner_id)
            .where(Project.id == project_id)
        )
    ).one_or_none()
    if row is None:
        raise _not_found()
    project, owner = row
    if owner.id == user.id or user.role is UserRole.ADMIN:
        return project, owner
    if user.role is UserRole.TEACHER and await group_service.teaches(session, user.id, owner.id):
        return project, owner
    raise _not_found()


async def create_project(
    session: AsyncSession, owner: User, data: ProjectCreate, *, max_projects: int
) -> Project:
    count = await session.scalar(
        select(func.count()).select_from(Project).where(Project.owner_id == owner.id)
    )
    if (count or 0) >= max_projects:
        raise ApiError(
            409,
            ErrorCode.PROJECT_LIMIT_REACHED,
            f"Project limit reached ({max_projects}); delete unused projects.",
        )
    circuit = (
        empty_circuit(data.board)
        if data.circuit is None
        else check_circuit(data.circuit, data.board)
    )
    project = Project(
        owner_id=owner.id,
        name=data.name,
        description=data.description,
        board=data.board,
        code=DEFAULT_SKETCH if data.code is None else _check_code(data.code),
        circuit=circuit,
        schema_version=SUPPORTED_SCHEMA_VERSION,
        revision=1,
    )
    session.add(project)
    await session.flush()
    await session.refresh(project)
    session.add(_snapshot(project))
    await session.commit()
    return project


async def update_project(
    session: AsyncSession, owner: User, project_id: uuid.UUID, data: ProjectUpdate
) -> Project:
    # Блокировка строки: параллельные изменения одного проекта выполняются по очереди,
    # и проверка номера версии не может «проскочить» между чтением и записью.
    project = await get_project(session, owner, project_id, for_update=True)
    if project.revision != data.revision:
        raise ApiError(
            409,
            ErrorCode.REVISION_CONFLICT,
            "Project was changed by another save.",
            [
                ErrorDetail(
                    field="revision",
                    message=f"Current revision is {project.revision}.",
                    code="STALE_REVISION",
                )
            ],
        )

    changes: dict[str, Any] = {}
    if data.name is not None and data.name != project.name:
        changes["name"] = data.name
    if data.description is not None and data.description != project.description:
        changes["description"] = data.description
    if data.code is not None and data.code != project.code:
        changes["code"] = _check_code(data.code)
    if data.circuit is not None and data.circuit != project.circuit:
        changes["circuit"] = check_circuit(data.circuit, project.board)
    if not changes:
        # Завершаем транзакцию (снимаем блокировку строки) без изменений; commit, а не
        # rollback: rollback сделал бы атрибуты объекта недоступными для ответа.
        await session.commit()
        return project

    for key, value in changes.items():
        setattr(project, key, value)
    project.revision += 1
    await session.flush()
    await session.refresh(project)
    if "code" in changes or "circuit" in changes:
        session.add(_snapshot(project))
        await session.flush()
        await _prune_revisions(session, project.id)
    await session.commit()
    return project


async def delete_project(session: AsyncSession, owner: User, project_id: uuid.UUID) -> None:
    project = await get_project(session, owner, project_id, for_update=True)
    await session.delete(project)
    await session.commit()


async def list_revisions(
    session: AsyncSession, user: User, project_id: uuid.UUID
) -> list[ProjectRevision]:
    await get_readable_project(session, user, project_id)
    result = await session.scalars(
        select(ProjectRevision)
        .where(ProjectRevision.project_id == project_id)
        .order_by(ProjectRevision.revision.desc())
    )
    return list(result)


async def get_revision(
    session: AsyncSession, user: User, project_id: uuid.UUID, revision: int
) -> ProjectRevision:
    await get_readable_project(session, user, project_id)
    snapshot = await session.scalar(
        select(ProjectRevision).where(
            ProjectRevision.project_id == project_id, ProjectRevision.revision == revision
        )
    )
    if snapshot is None:
        raise ApiError(404, ErrorCode.REVISION_NOT_FOUND, "Project revision not found.")
    return snapshot
