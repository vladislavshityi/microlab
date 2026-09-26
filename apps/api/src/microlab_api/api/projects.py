"""Проекты текущего пользователя: CRUD, история версий, проверка и компиляция проекта.

Список содержит только собственные проекты. Чтение проекта и его истории доступно также
преподавателю группы владельца и администратору (``access: "viewer"``); изменение,
проверка и компиляция — только владельцу. Недоступные проекты неотличимы от
несуществующих (404 PROJECT_NOT_FOUND). Изменение проекта
требует номер версии, на которой основано изменение (``revision``); при расхождении —
409 REVISION_CONFLICT, данные не перезаписываются.
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.circuits import build_validation_response
from microlab_api.api.compilation import (
    COMPILE_RESPONSES,
    check_compile_rate,
    get_compiler,
    run_compilation,
)
from microlab_api.api.current_user import CurrentUser
from microlab_api.config import Settings
from microlab_api.db.database import get_session
from microlab_api.models import Project, ProjectRevision, User
from microlab_api.schemas.compile import CompileResponse
from microlab_api.schemas.errors import ErrorResponse
from microlab_api.schemas.projects import (
    ProjectCreate,
    ProjectDetail,
    ProjectList,
    ProjectOwner,
    ProjectRevisionDetail,
    ProjectRevisionList,
    ProjectRevisionSummary,
    ProjectSummary,
    ProjectUpdate,
)
from microlab_api.schemas.validation import CircuitValidationResponse
from microlab_api.services import project_service
from microlab_api.services.compiler_service import CompilerClient

router = APIRouter(prefix="/projects", tags=["projects"])

Session = Annotated[AsyncSession, Depends(get_session)]


def _error(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}


_COMMON: dict[int | str, dict[str, Any]] = {
    401: _error("Not logged in (AUTH_REQUIRED)."),
    403: _error("CSRF_FAILED or PASSWORD_CHANGE_REQUIRED."),
    500: _error("Unexpected server error."),
    503: _error("Database is unavailable."),
}
_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: _error("Project not found (PROJECT_NOT_FOUND).")
}
_WRITE: dict[int | str, dict[str, Any]] = {
    413: _error("Source exceeds 256 KiB (SOURCE_TOO_LARGE)."),
    422: _error("Invalid request (VALIDATION_ERROR) or circuit document (INVALID_CIRCUIT)."),
}


def _summary(project: Project) -> ProjectSummary:
    return ProjectSummary(
        id=project.id,
        name=project.name,
        description=project.description,
        board="arduino-uno-r3",
        schema_version=project.schema_version,
        revision=project.revision,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _detail(project: Project, owner: User, viewer: User) -> ProjectDetail:
    return ProjectDetail(
        **_summary(project).model_dump(),
        owner=ProjectOwner(id=owner.id, display_name=owner.display_name),
        access="owner" if owner.id == viewer.id else "viewer",
        code=project.code,
        circuit=project.circuit,
    )


def _revision_summary(snapshot: ProjectRevision) -> ProjectRevisionSummary:
    return ProjectRevisionSummary(
        revision=snapshot.revision,
        schema_version=snapshot.schema_version,
        created_at=snapshot.created_at,
    )


@router.get(
    "",
    response_model=ProjectList,
    responses=_COMMON,
    summary="List the current user's projects (most recently updated first)",
    operation_id="listProjects",
)
async def list_projects(session: Session, user: CurrentUser) -> ProjectList:
    projects = await project_service.list_projects(session, user)
    return ProjectList(items=[_summary(project) for project in projects])


@router.post(
    "",
    status_code=201,
    response_model=ProjectDetail,
    responses={
        **_COMMON,
        **_WRITE,
        409: _error("Per-user project limit reached (PROJECT_LIMIT_REACHED)."),
    },
    summary="Create a project",
    operation_id="createProject",
)
async def create_project(
    body: ProjectCreate, request: Request, session: Session, user: CurrentUser
) -> ProjectDetail:
    settings: Settings = request.app.state.settings
    project = await project_service.create_project(
        session, user, body, max_projects=settings.max_projects_per_user
    )
    return _detail(project, user, user)


@router.get(
    "/{project_id}",
    response_model=ProjectDetail,
    responses={**_COMMON, **_NOT_FOUND},
    summary="Get a project (own, or read-only for a teacher of the owner's group or an admin)",
    operation_id="getProject",
)
async def get_project(project_id: uuid.UUID, session: Session, user: CurrentUser) -> ProjectDetail:
    project, owner = await project_service.get_readable_project(session, user, project_id)
    return _detail(project, owner, user)


@router.patch(
    "/{project_id}",
    response_model=ProjectDetail,
    responses={
        **_COMMON,
        **_NOT_FOUND,
        **_WRITE,
        409: _error("The project changed since the given revision (REVISION_CONFLICT)."),
    },
    summary="Update a project (optimistic concurrency via revision)",
    operation_id="updateProject",
)
async def update_project(
    project_id: uuid.UUID, body: ProjectUpdate, session: Session, user: CurrentUser
) -> ProjectDetail:
    return _detail(
        await project_service.update_project(session, user, project_id, body), user, user
    )


@router.delete(
    "/{project_id}",
    status_code=204,
    response_class=Response,
    responses={**_COMMON, **_NOT_FOUND},
    summary="Delete a project and its revisions",
    operation_id="deleteProject",
)
async def delete_project(project_id: uuid.UUID, session: Session, user: CurrentUser) -> Response:
    await project_service.delete_project(session, user, project_id)
    return Response(status_code=204)


@router.get(
    "/{project_id}/revisions",
    response_model=ProjectRevisionList,
    responses={**_COMMON, **_NOT_FOUND},
    summary="List stored revisions of a project (newest first)",
    operation_id="listProjectRevisions",
)
async def list_revisions(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> ProjectRevisionList:
    snapshots = await project_service.list_revisions(session, user, project_id)
    return ProjectRevisionList(items=[_revision_summary(item) for item in snapshots])


@router.get(
    "/{project_id}/revisions/{revision}",
    response_model=ProjectRevisionDetail,
    responses={**_COMMON, 404: _error("PROJECT_NOT_FOUND or REVISION_NOT_FOUND.")},
    summary="Get a stored revision of a project",
    operation_id="getProjectRevision",
)
async def get_revision(
    project_id: uuid.UUID, revision: int, session: Session, user: CurrentUser
) -> ProjectRevisionDetail:
    snapshot = await project_service.get_revision(session, user, project_id, revision)
    return ProjectRevisionDetail(
        **_revision_summary(snapshot).model_dump(), code=snapshot.code, circuit=snapshot.circuit
    )


@router.post(
    "/{project_id}/validate",
    response_model=CircuitValidationResponse,
    responses={**_COMMON, **_NOT_FOUND},
    summary="Validate the stored circuit of a project",
    operation_id="validateProject",
)
async def validate_project(
    project_id: uuid.UUID, session: Session, user: CurrentUser
) -> CircuitValidationResponse:
    project = await project_service.get_project(session, user, project_id)
    return build_validation_response(project.circuit)


@router.post(
    "/{project_id}/compile",
    response_model=CompileResponse,
    responses={**COMPILE_RESPONSES, **_COMMON, **_NOT_FOUND},
    summary="Compile the stored sketch of a project",
    operation_id="compileProject",
)
async def compile_project(
    project_id: uuid.UUID,
    request: Request,
    session: Session,
    user: CurrentUser,
    compiler: Annotated[CompilerClient, Depends(get_compiler)],
) -> CompileResponse | JSONResponse:
    project = await project_service.get_project(session, user, project_id)
    check_compile_rate(request, user.id)
    # Транзакция чтения не должна оставаться открытой на время компиляции.
    code = project.code
    await session.close()
    return await run_compilation(compiler, code)
