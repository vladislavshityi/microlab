"""Счётчик версий проекта и таблица project_revisions

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-26 09:00:00.000000+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Идентификаторы ревизии, используемые Alembic.
revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.create_check_constraint(op.f("ck_projects_revision_positive"), "projects", "revision >= 1")
    op.create_table(
        "project_revisions",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("circuit", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_project_revisions_revision_positive")),
        sa.CheckConstraint(
            "schema_version >= 1", name=op.f("ck_project_revisions_schema_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_revisions_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_revisions")),
        sa.UniqueConstraint(
            "project_id", "revision", name=op.f("uq_project_revisions_project_id_revision")
        ),
    )
    # Существующие проекты получают снимок текущего состояния как версию 1.
    op.execute(
        "INSERT INTO project_revisions (project_id, revision, code, circuit, schema_version) "
        "SELECT id, revision, code, circuit, schema_version FROM projects"
    )


def downgrade() -> None:
    op.drop_table("project_revisions")
    op.drop_constraint(op.f("ck_projects_revision_positive"), "projects", type_="check")
    op.drop_column("projects", "revision")
