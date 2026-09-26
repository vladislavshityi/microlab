import pytest
from sqlalchemy import delete, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from microlab_api.models import Project, User

pytestmark = [pytest.mark.anyio, pytest.mark.usefixtures("clean_db")]


async def _create_user(engine: AsyncEngine) -> object:
    async with engine.begin() as conn:
        return (
            await conn.execute(
                insert(User)
                .values(email="owner@example.edu", display_name="o", role="student")
                .returning(User.id)
            )
        ).scalar_one()


async def test_project_defaults(engine: AsyncEngine) -> None:
    owner_id = await _create_user(engine)
    async with engine.begin() as conn:
        row = (
            await conn.execute(
                insert(Project)
                .values(owner_id=owner_id, name="p", board="b", circuit={}, schema_version=1)
                .returning(Project.description, Project.code, Project.id, Project.created_at)
            )
        ).one()

    assert row.description == ""
    assert row.code == ""
    assert row.id is not None
    assert row.created_at.tzinfo is not None


async def test_schema_version_must_be_positive(engine: AsyncEngine) -> None:
    owner_id = await _create_user(engine)
    with pytest.raises(IntegrityError, match="ck_projects_schema_version_positive"):
        async with engine.begin() as conn:
            await conn.execute(
                insert(Project).values(
                    owner_id=owner_id, name="p", board="b", circuit={}, schema_version=0
                )
            )


async def test_owner_with_projects_cannot_be_deleted(engine: AsyncEngine) -> None:
    owner_id = await _create_user(engine)
    async with engine.begin() as conn:
        await conn.execute(
            insert(Project).values(
                owner_id=owner_id, name="p", board="b", circuit={}, schema_version=1
            )
        )

    with pytest.raises(IntegrityError, match="fk_projects_owner_id_users"):
        async with engine.begin() as conn:
            await conn.execute(delete(User).where(User.id == owner_id))


async def test_email_is_unique(engine: AsyncEngine) -> None:
    await _create_user(engine)
    with pytest.raises(IntegrityError, match="uq_users_email"):
        await _create_user(engine)


async def test_email_must_be_lowercase(engine: AsyncEngine) -> None:
    with pytest.raises(IntegrityError, match="ck_users_email_lowercase"):
        async with engine.begin() as conn:
            await conn.execute(
                insert(User).values(email="A@example.edu", display_name="a", role="student")
            )
