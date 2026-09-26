import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from microlab_api.models.base import Base, TimestampMixin


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("schema_version >= 1", name="schema_version_positive"),
        CheckConstraint("revision >= 1", name="revision_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, server_default=text("''"))
    # Идентификатор платы (тип определения платы из packages/circuit-schema).
    board: Mapped[str] = mapped_column(Text)
    code: Mapped[str] = mapped_column(Text, server_default=text("''"))
    # Документ схемы; его формат определяет packages/circuit-schema.
    circuit: Mapped[dict[str, Any]] = mapped_column(JSONB)
    schema_version: Mapped[int] = mapped_column(Integer)
    # Номер версии проекта для оптимистичной блокировки: растёт при каждом изменении.
    revision: Mapped[int] = mapped_column(Integer, server_default=text("1"))


class ProjectRevision(Base):
    """Снимок кода и схемы проекта после изменения (история изменений)."""

    __tablename__ = "project_revisions"
    __table_args__ = (
        UniqueConstraint("project_id", "revision"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint("schema_version >= 1", name="schema_version_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE")
    )
    # Совпадает с projects.revision в момент создания снимка.
    revision: Mapped[int] = mapped_column(Integer)
    code: Mapped[str] = mapped_column(Text)
    circuit: Mapped[dict[str, Any]] = mapped_column(JSONB)
    schema_version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
