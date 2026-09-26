"""Аутентификация, группы, коды приглашения, администрирование и матрица прав доступа."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from microlab_api.app import create_app
from microlab_api.auth.rate_limit import SlidingWindowLimiter
from microlab_api.auth.sessions import SESSION_COOKIE, now_utc
from microlab_api.config import Settings
from microlab_api.models import AuthSession, InviteCode, User, UserRole
from microlab_api.scripts import create_admin
from tests.conftest import CSRF_HEADERS, DEFAULT_PASSWORD, create_user, login

pytestmark = pytest.mark.anyio

AUTH = "/api/v1/auth"
TEACHER = "teacher@example.edu"
ADMIN = "admin@example.edu"
STUDENT = "student@example.edu"


@pytest.fixture
async def make_client(test_settings: Settings, clean_db: None) -> AsyncIterator[Any]:
    apps: list[Any] = []
    clients: list[AsyncClient] = []

    async def factory(**overrides: Any) -> AsyncClient:
        app = create_app(test_settings.model_copy(update=overrides))
        apps.append(app)
        http = AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
            headers=CSRF_HEADERS,
        )
        clients.append(http)
        return http

    yield factory
    for http in clients:
        await http.aclose()
    for app in apps:
        await app.state.database.dispose()


async def _as(make_client: Any, email: str, **overrides: Any) -> AsyncClient:
    http: AsyncClient = await make_client(**overrides)
    await login(http, email)
    return http


async def _group_with_invite(teacher: AsyncClient, **invite: Any) -> tuple[str, str]:
    group = await teacher.post("/api/v1/groups", json={"name": "ИВТ-21"})
    assert group.status_code == 201, group.text
    group_id = group.json()["id"]
    created = await teacher.post(f"/api/v1/groups/{group_id}/invites", json=invite)
    assert created.status_code == 201, created.text
    return group_id, created.json()["code"]


def _register_body(code: str, email: str = STUDENT, password: str = DEFAULT_PASSWORD) -> Any:
    return {"inviteCode": code, "email": email, "displayName": "Иван", "password": password}


# --- вход и сессии ---


async def test_login_me_logout(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    http = await make_client()
    response = await http.post(
        f"{AUTH}/login", json={"email": " Teacher@Example.edu ", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie  # test: Secure выключен (HTTP)
    me = (await http.get(f"{AUTH}/me")).json()
    assert (me["email"], me["role"], me["mustChangePassword"]) == (TEACHER, "teacher", False)

    assert (await http.post(f"{AUTH}/logout")).status_code == 204
    assert (await http.get(f"{AUTH}/me")).json()["error"]["code"] == "AUTH_REQUIRED"


async def test_secure_cookie_in_production_by_default(test_settings: Settings) -> None:
    assert test_settings.model_copy(update={"env": "production"}).cookie_secure is True
    assert (
        test_settings.model_copy(
            update={"env": "production", "session_cookie_secure": False}
        ).cookie_secure
        is False
    )


@pytest.mark.parametrize(
    ("email", "password"),
    [(TEACHER, "wrong-password"), ("nobody@example.edu", DEFAULT_PASSWORD)],
)
async def test_login_errors_are_generic(
    make_client: Any, engine: AsyncEngine, email: str, password: str
) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    http = await make_client()
    response = await http.post(f"{AUTH}/login", json={"email": email, "password": password})
    assert response.status_code == 401
    assert response.json()["error"] == {
        "code": "INVALID_CREDENTIALS",
        "message": "Invalid email or password.",
        "details": [],
    }


async def test_deactivated_user_cannot_login(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER, is_active=False)
    http = await make_client()
    response = await http.post(
        f"{AUTH}/login", json={"email": TEACHER, "password": DEFAULT_PASSWORD}
    )
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


async def test_login_rate_limit_per_account(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    http = await make_client(login_attempts_per_account=3)
    for _ in range(3):
        bad = await http.post(f"{AUTH}/login", json={"email": TEACHER, "password": "nope-nope"})
        assert bad.status_code == 401
    blocked = await http.post(
        f"{AUTH}/login", json={"email": TEACHER, "password": DEFAULT_PASSWORD}
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert int(blocked.headers["retry-after"]) >= 1


async def test_login_rate_limit_per_ip(make_client: Any, engine: AsyncEngine) -> None:
    http = await make_client(login_attempts_per_ip=2)
    for i in range(2):
        await http.post(f"{AUTH}/login", json={"email": f"u{i}@x.edu", "password": "nope-nope"})
    blocked = await http.post(f"{AUTH}/login", json={"email": "u9@x.edu", "password": "x"})
    assert blocked.status_code == 429


def test_sliding_window_expires() -> None:
    now = [0.0]
    limiter = SlidingWindowLimiter(2, 10.0, clock=lambda: now[0])
    limiter.hit("k")
    limiter.hit("k")
    assert limiter.retry_after("k") == pytest.approx(10.0)
    now[0] = 10.5
    assert limiter.retry_after("k") is None


async def test_expired_and_idle_sessions(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    http = await _as(make_client, TEACHER)
    async with engine.begin() as conn:
        await conn.execute(update(AuthSession).values(last_seen=now_utc() - timedelta(hours=25)))
    assert (await http.get(f"{AUTH}/me")).status_code == 401
    async with engine.connect() as conn:
        assert (await conn.execute(select(AuthSession))).first() is None

    await login(http, TEACHER)
    async with engine.begin() as conn:
        await conn.execute(update(AuthSession).values(expires_at=now_utc()))
    assert (await http.get(f"{AUTH}/me")).status_code == 401


async def test_token_is_hashed_at_rest(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    http = await _as(make_client, TEACHER)
    token = http.cookies[SESSION_COOKIE]
    async with engine.connect() as conn:
        stored = await conn.scalar(select(AuthSession.id))
    assert stored is not None
    assert token not in stored
    assert len(stored) == 64


async def test_logout_all_and_change_password(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    first = await _as(make_client, TEACHER)
    second = await _as(make_client, TEACHER)

    weak = await first.post(
        f"{AUTH}/change-password",
        json={"currentPassword": DEFAULT_PASSWORD, "newPassword": "short"},
    )
    assert weak.json()["error"]["code"] == "WEAK_PASSWORD"
    wrong = await first.post(
        f"{AUTH}/change-password",
        json={"currentPassword": "wrong-one", "newPassword": "another-password"},
    )
    assert wrong.json()["error"]["code"] == "INVALID_CREDENTIALS"
    changed = await first.post(
        f"{AUTH}/change-password",
        json={"currentPassword": DEFAULT_PASSWORD, "newPassword": "another-password"},
    )
    assert changed.status_code == 200
    # Смена пароля завершает остальные сессии.
    assert (await second.get(f"{AUTH}/me")).status_code == 401
    assert (await first.get(f"{AUTH}/me")).status_code == 200

    assert (await first.post(f"{AUTH}/logout-all")).status_code == 204
    assert (await first.get(f"{AUTH}/me")).status_code == 401


# --- CSRF ---


async def test_csrf_header_and_origin_are_required(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    http = await _as(make_client, TEACHER)
    no_header = await http.post(
        "/api/v1/groups", json={"name": "x"}, headers={"X-MicroLab-Request": ""}
    )
    assert no_header.status_code == 403
    assert no_header.json()["error"]["code"] == "CSRF_FAILED"
    foreign = await http.post(
        "/api/v1/groups", json={"name": "x"}, headers={"Origin": "https://evil.example"}
    )
    assert foreign.json()["error"]["code"] == "CSRF_FAILED"
    same = await http.post(
        "/api/v1/groups", json={"name": "x"}, headers={"Origin": "http://testserver"}
    )
    assert same.status_code == 201
    # Безопасные методы не требуют заголовка.
    assert (await http.get("/api/v1/groups", headers={"X-MicroLab-Request": ""})).status_code == 200


async def test_allowed_origins(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    http = await _as(make_client, TEACHER, allowed_origins=["https://lab.example.edu"])
    response = await http.post(
        "/api/v1/groups", json={"name": "x"}, headers={"Origin": "https://lab.example.edu"}
    )
    assert response.status_code == 201


# --- приглашения и регистрация ---


async def test_register_with_invite_joins_group(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    teacher = await _as(make_client, TEACHER)
    group_id, code = await _group_with_invite(teacher)
    assert len(code) == 12

    student = await make_client()
    # Код вводится без учёта регистра и с разделителями.
    formatted = f"{code[:4].lower()}-{code[4:8]} {code[8:]}"
    response = await student.post(f"{AUTH}/register", json=_register_body(formatted))
    assert response.status_code == 201, response.text
    assert response.json()["role"] == "student"
    assert (await student.get(f"{AUTH}/me")).status_code == 200

    members = (await teacher.get(f"/api/v1/groups/{group_id}/members")).json()["items"]
    assert [m["email"] for m in members] == [STUDENT]
    invites = (await teacher.get(f"/api/v1/groups/{group_id}/invites")).json()["items"]
    assert invites[0]["uses"] == 1

    duplicate = await (await make_client()).post(f"{AUTH}/register", json=_register_body(code))
    assert duplicate.json()["error"]["code"] == "EMAIL_TAKEN"


@pytest.mark.parametrize("case", ["revoked", "expired", "used_up", "unknown"])
async def test_invalid_invite_codes(make_client: Any, engine: AsyncEngine, case: str) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    teacher = await _as(make_client, TEACHER)
    group_id, code = await _group_with_invite(teacher, maxUses=1)
    if case == "revoked":
        invite_id = (await teacher.get(f"/api/v1/groups/{group_id}/invites")).json()["items"][0][
            "id"
        ]
        revoked = await teacher.post(f"/api/v1/groups/{group_id}/invites/{invite_id}/revoke")
        assert revoked.json()["active"] is False
    elif case == "expired":
        async with engine.begin() as conn:
            await conn.execute(update(InviteCode).values(expires_at=now_utc()))
    elif case == "used_up":
        first = await (await make_client()).post(
            f"{AUTH}/register", json=_register_body(code, "first@example.edu")
        )
        assert first.status_code == 201
    else:
        code = "ABCDEFGHJKMN"
    response = await (await make_client()).post(f"{AUTH}/register", json=_register_body(code))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_INVITE_CODE"
    async with engine.connect() as conn:
        assert await conn.scalar(select(User.id).where(User.email == STUDENT)) is None


async def test_register_password_policy(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    teacher = await _as(make_client, TEACHER)
    _group_id, code = await _group_with_invite(teacher)
    http = await make_client()
    for password in ["1234567", STUDENT.upper()]:
        response = await http.post(f"{AUTH}/register", json=_register_body(code, password=password))
        assert response.json()["error"]["code"] == "WEAK_PASSWORD"
    invites = (await teacher.get(f"/api/v1/groups/{_group_id}/invites")).json()["items"]
    assert invites[0]["uses"] == 0


async def test_student_joins_second_group(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, TEACHER, UserRole.TEACHER)
    await create_user(engine, STUDENT)
    teacher = await _as(make_client, TEACHER)
    _group_id, code = await _group_with_invite(teacher)
    student = await _as(make_client, STUDENT)
    joined = await student.post("/api/v1/groups/join", json={"inviteCode": code})
    assert joined.status_code == 200
    assert [g["name"] for g in (await student.get("/api/v1/groups")).json()["items"]] == ["ИВТ-21"]


# --- администрирование ---


async def test_admin_manages_users(make_client: Any, engine: AsyncEngine) -> None:
    admin_id = await create_user(engine, ADMIN, UserRole.ADMIN)
    admin = await _as(make_client, ADMIN)

    created = await admin.post(
        "/api/v1/admin/users",
        json={"email": TEACHER, "displayName": "Пётр Петрович", "role": "teacher"},
    )
    assert created.status_code == 201
    body = created.json()
    temporary = body["temporaryPassword"]
    assert body["user"]["mustChangePassword"] is True

    teacher = await make_client()
    await login(teacher, TEACHER, temporary)
    blocked = await teacher.get("/api/v1/groups")
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    changed = await teacher.post(
        f"{AUTH}/change-password",
        json={"currentPassword": temporary, "newPassword": "teacher-password"},
    )
    assert changed.json()["mustChangePassword"] is False
    assert (await teacher.get("/api/v1/groups")).status_code == 200

    listing = (await admin.get("/api/v1/admin/users", params={"q": "пётр"})).json()
    assert listing["total"] == 1
    teacher_id = listing["items"][0]["id"]
    page = (await admin.get("/api/v1/admin/users", params={"limit": 1})).json()
    assert (page["total"], len(page["items"])) == (2, 1)
    assert (await admin.get("/api/v1/admin/users", params={"q": "%"})).json()["total"] == 0

    reset = await admin.post(f"/api/v1/admin/users/{teacher_id}/reset-password")
    assert len(reset.json()["temporaryPassword"]) >= 12
    assert (await teacher.get(f"{AUTH}/me")).status_code == 401

    deactivated = await admin.patch(f"/api/v1/admin/users/{teacher_id}", json={"isActive": False})
    assert deactivated.json()["isActive"] is False
    promoted = await admin.patch(f"/api/v1/admin/users/{teacher_id}", json={"role": "admin"})
    assert promoted.json()["role"] == "admin"

    self_demote = await admin.patch(f"/api/v1/admin/users/{admin_id}", json={"role": "student"})
    assert self_demote.status_code == 422
    taken = await admin.post(
        "/api/v1/admin/users", json={"email": TEACHER, "displayName": "x", "role": "student"}
    )
    assert taken.json()["error"]["code"] == "EMAIL_TAKEN"
    missing = await admin.post(f"/api/v1/admin/users/{uuid.uuid4()}/reset-password")
    assert missing.json()["error"]["code"] == "USER_NOT_FOUND"


# --- матрица прав ---


@pytest.fixture
async def world(make_client: Any, engine: AsyncEngine) -> dict[str, Any]:
    """Преподаватель с группой, студент группы с проектом, посторонние студент и преподаватель."""
    await create_user(engine, ADMIN, UserRole.ADMIN)
    await create_user(engine, TEACHER, UserRole.TEACHER)
    await create_user(engine, "other-teacher@example.edu", UserRole.TEACHER)
    await create_user(engine, "outsider@example.edu")
    clients = {
        "admin": await _as(make_client, ADMIN),
        "teacher": await _as(make_client, TEACHER),
        "other_teacher": await _as(make_client, "other-teacher@example.edu"),
        "outsider": await _as(make_client, "outsider@example.edu"),
        "anonymous": await make_client(),
    }
    group_id, code = await _group_with_invite(clients["teacher"])
    student = await make_client()
    registered = await student.post(f"{AUTH}/register", json=_register_body(code))
    assert registered.status_code == 201
    clients["student"] = student
    project = await student.post("/api/v1/projects", json={"name": "Мигалка"})
    return {"clients": clients, "group": group_id, "project": project.json()["id"]}


READ_PROJECT = {"student": 200, "teacher": 200, "admin": 200, "other_teacher": 404,
                "outsider": 404, "anonymous": 401}  # fmt: skip
OWNER_ONLY = {"student": 200, "teacher": 404, "admin": 404, "other_teacher": 404,
              "outsider": 404, "anonymous": 401}  # fmt: skip
MANAGE_GROUP = {"student": 403, "teacher": 200, "admin": 200, "other_teacher": 404,
                "outsider": 403, "anonymous": 401}  # fmt: skip
ADMIN_ONLY = {"student": 403, "teacher": 403, "admin": 200, "other_teacher": 403,
              "outsider": 403, "anonymous": 401}  # fmt: skip


@pytest.mark.parametrize(
    ("method", "path", "body", "expected"),
    [
        ("GET", "/projects/{project}", None, READ_PROJECT),
        ("GET", "/projects/{project}/revisions", None, READ_PROJECT),
        ("GET", "/projects/{project}/revisions/1", None, READ_PROJECT),
        ("PATCH", "/projects/{project}", {"revision": 1, "name": "x"}, OWNER_ONLY),
        ("POST", "/projects/{project}/validate", None, OWNER_ONLY),
        ("GET", "/projects/{project}/simulation", None, OWNER_ONLY),
        ("GET", "/groups/{group}", None, MANAGE_GROUP),
        ("GET", "/groups/{group}/members", None, MANAGE_GROUP),
        ("GET", "/groups/{group}/invites", None, MANAGE_GROUP),
        ("GET", "/groups/{group}/projects", None, MANAGE_GROUP),
        ("PATCH", "/groups/{group}", {"name": "Новое"}, MANAGE_GROUP),
        ("GET", "/admin/users", None, ADMIN_ONLY),
    ],
)
async def test_authorization_matrix(
    world: dict[str, Any], method: str, path: str, body: Any, expected: dict[str, int]
) -> None:
    url = "/api/v1" + path.format(project=world["project"], group=world["group"])
    for role, status in expected.items():
        response = await world["clients"][role].request(method, url, json=body)
        assert response.status_code == status, (role, method, url, response.text)


async def test_viewer_access_and_group_projects(world: dict[str, Any]) -> None:
    teacher = world["clients"]["teacher"]
    detail = (await teacher.get(f"/api/v1/projects/{world['project']}")).json()
    assert detail["access"] == "viewer"
    assert detail["owner"]["displayName"] == "Иван"
    own = (await world["clients"]["student"].get(f"/api/v1/projects/{world['project']}")).json()
    assert own["access"] == "owner"
    listing = (await teacher.get(f"/api/v1/groups/{world['group']}/projects")).json()["items"]
    assert [(p["name"], p["owner"]["displayName"]) for p in listing] == [("Мигалка", "Иван")]
    # Список проектов всегда только собственный.
    assert (await teacher.get("/api/v1/projects")).json()["items"] == []
    # Преподаватель не запускает симуляцию проекта студента.
    start = await teacher.post(f"/api/v1/projects/{world['project']}/simulation/start")
    assert start.status_code == 404


async def test_removed_member_is_no_longer_visible(world: dict[str, Any]) -> None:
    teacher = world["clients"]["teacher"]
    members = (await teacher.get(f"/api/v1/groups/{world['group']}/members")).json()["items"]
    removed = await teacher.delete(f"/api/v1/groups/{world['group']}/members/{members[0]['id']}")
    assert removed.status_code == 204
    assert (await teacher.get(f"/api/v1/projects/{world['project']}")).status_code == 404


async def test_compile_rate_limit(make_client: Any, engine: AsyncEngine) -> None:
    await create_user(engine, STUDENT)
    http = await _as(make_client, STUDENT, compile_rate_per_minute=1, compiler_url=None)
    first = await http.post("/api/v1/compile", json={"code": "void setup(){}"})
    assert first.status_code != 429
    second = await http.post("/api/v1/compile", json={"code": "void setup(){}"})
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "RATE_LIMITED"


# --- создание администратора ---


def test_create_admin_command(
    test_database_url: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:

    settings = Settings(env="test", database_url=SecretStr(test_database_url))

    async def truncate() -> list[tuple[str, str]]:
        engine = create_async_engine(test_database_url)
        try:
            async with engine.begin() as conn:
                rows = [
                    (row.email, row.role)
                    for row in await conn.execute(
                        text("SELECT email, role::text AS role FROM users")
                    )
                ]
                await conn.execute(text("TRUNCATE users, projects CASCADE"))
                return rows
        finally:
            await engine.dispose()

    asyncio.run(truncate())
    monkeypatch.setenv(create_admin.PASSWORD_ENV, "short")
    assert create_admin.main(["--email", ADMIN], settings) == 2
    monkeypatch.setenv(create_admin.PASSWORD_ENV, "admin-password")
    assert create_admin.main(["--email", "Admin@Example.edu"], settings) == 0
    assert create_admin.main(["--email", ADMIN], settings) == 1
    assert "already exists" in capsys.readouterr().err
    assert asyncio.run(truncate()) == [(ADMIN, "admin")]
