"""Модели API проектов."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import Field, StringConstraints

from microlab_api.schemas.base import ApiModel

type ProjectName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
type ProjectDescription = Annotated[str, StringConstraints(max_length=2000)]
# Единственная плата MVP.
type BoardType = Literal["arduino-uno-r3"]


class ProjectSummary(ApiModel):
    """Проект без кода и схемы (для списка)."""

    id: uuid.UUID
    name: str
    description: str
    board: BoardType
    schema_version: int
    revision: int = Field(description="Current project revision (optimistic concurrency token).")
    created_at: datetime
    updated_at: datetime


class ProjectDetail(ProjectSummary):
    code: str
    circuit: dict[str, Any] = Field(description="Circuit document (CircuitDocument).")


class ProjectList(ApiModel):
    items: list[ProjectSummary]


class ProjectCreate(ApiModel):
    name: ProjectName
    description: ProjectDescription = ""
    board: BoardType = "arduino-uno-r3"
    code: str | None = Field(default=None, description="Defaults to an empty sketch skeleton.")
    circuit: dict[str, Any] | None = Field(
        default=None, description="Defaults to an empty circuit with the board only."
    )


class ProjectUpdate(ApiModel):
    """Частичное изменение: отсутствующие (или null) поля не меняются."""

    revision: int = Field(
        ge=1, description="Revision the change is based on; a mismatch returns REVISION_CONFLICT."
    )
    name: ProjectName | None = None
    description: ProjectDescription | None = None
    code: str | None = None
    circuit: dict[str, Any] | None = None


class ProjectRevisionSummary(ApiModel):
    revision: int
    schema_version: int
    created_at: datetime


class ProjectRevisionList(ApiModel):
    items: list[ProjectRevisionSummary] = Field(description="Newest first.")


class ProjectRevisionDetail(ProjectRevisionSummary):
    code: str
    circuit: dict[str, Any]
