"""Пользователи с паролями и ролями, группы, коды приглашения, сессии

Существующие строки users (включая dev-user из режима разработки) становятся учётными
записями студентов без пароля: войти в них нельзя, пока администратор не сбросит пароль.
Их проекты сохраняются. Адрес: ``<username>@local.invalid``.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26 12:00:00.000000+00:00

"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

# Идентификаторы ревизии, используемые Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

user_role = sa.Enum("student", "teacher", "admin", name="user_role")


def _created_at(name: str = "created_at") -> sa.Column[datetime]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade() -> None:
    user_role.create(op.get_bind())
    op.add_column("users", sa.Column("email", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("display_name", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("role", user_role, nullable=True))
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.add_column(
        "users",
        sa.Column(
            "must_change_password", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
    )
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE users SET email = lower(username) || '@local.invalid', "
        "display_name = username, role = 'student'"
    )
    op.alter_column("users", "email", nullable=False)
    op.alter_column("users", "display_name", nullable=False)
    op.alter_column("users", "role", nullable=False)
    op.drop_constraint(op.f("uq_users_username"), "users", type_="unique")
    op.drop_column("users", "username")
    op.create_unique_constraint(op.f("uq_users_email"), "users", ["email"])
    op.create_check_constraint(op.f("ck_users_email_lowercase"), "users", "email = lower(email)")

    op.create_table(
        "groups",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("teacher_id", sa.Uuid(), nullable=False),
        _created_at(),
        sa.ForeignKeyConstraint(
            ["teacher_id"],
            ["users.id"],
            name=op.f("fk_groups_teacher_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_groups")),
    )
    op.create_index(op.f("ix_groups_teacher_id"), "groups", ["teacher_id"])

    op.create_table(
        "group_members",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        _created_at("joined_at"),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name=op.f("fk_group_members_group_id_groups"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_group_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_group_members")),
        sa.UniqueConstraint("group_id", "user_id", name=op.f("uq_group_members_group_id_user_id")),
    )
    op.create_index(op.f("ix_group_members_user_id"), "group_members", ["user_id"])

    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("revoked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        _created_at(),
        sa.CheckConstraint("uses >= 0", name=op.f("ck_invite_codes_uses_non_negative")),
        sa.CheckConstraint(
            "max_uses IS NULL OR max_uses >= 1", name=op.f("ck_invite_codes_max_uses_positive")
        ),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["groups.id"],
            name=op.f("fk_invite_codes_group_id_groups"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invite_codes")),
        sa.UniqueConstraint("code", name=op.f("uq_invite_codes_code")),
    )
    op.create_index(op.f("ix_invite_codes_group_id"), "invite_codes", ["group_id"])

    op.create_table(
        "sessions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        _created_at(),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _created_at("last_seen"),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sessions_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
    )
    op.create_index(op.f("ix_sessions_user_id"), "sessions", ["user_id"])


def downgrade() -> None:
    op.drop_table("sessions")
    op.drop_table("invite_codes")
    op.drop_table("group_members")
    op.drop_table("groups")
    op.add_column("users", sa.Column("username", sa.Text(), nullable=True))
    # Имя пользователя восстанавливается из локальной части адреса (с id при совпадениях).
    op.execute(
        "UPDATE users u SET username = CASE WHEN (SELECT count(*) FROM users o "
        "WHERE split_part(o.email, '@', 1) = split_part(u.email, '@', 1)) > 1 "
        "THEN split_part(u.email, '@', 1) || '-' || u.id::text "
        "ELSE split_part(u.email, '@', 1) END"
    )
    op.alter_column("users", "username", nullable=False)
    op.drop_constraint(op.f("ck_users_email_lowercase"), "users", type_="check")
    op.drop_constraint(op.f("uq_users_email"), "users", type_="unique")
    for column in (
        "last_login_at",
        "must_change_password",
        "is_active",
        "role",
        "password_hash",
        "display_name",
        "email",
    ):
        op.drop_column("users", column)
    op.create_unique_constraint(op.f("uq_users_username"), "users", ["username"])
    user_role.drop(op.get_bind())
