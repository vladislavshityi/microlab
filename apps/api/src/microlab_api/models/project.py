import uuid
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Text, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from microlab_api.models.base import Base, TimestampMixin


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (CheckConstraint("schema_version >= 1", name="schema_version_positive"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=text("gen_random_uuid()")
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, server_default=text("''"))
    # Идентификатор платы. Значения позже определит packages/circuit-schema
    # (enum/CHECK пока нет).
    board: Mapped[str] = mapped_column(Text)
    code: Mapped[str] = mapped_column(Text, server_default=text("''"))
    # Документ схемы; его формат определяет packages/circuit-schema.
    circuit: Mapped[dict[str, Any]] = mapped_column(JSONB)
    schema_version: Mapped[int] = mapped_column(Integer)
