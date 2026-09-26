import copy
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncEngine

from microlab_api.app import create_app
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.config import Settings
from microlab_api.models import Project, ProjectRevision, User
from microlab_api.scripts.seed_dev_user import seed_dev_user
from microlab_api.services import project_service
from microlab_api.services.compiler_service import CompilerClient

pytestmark = pytest.mark.anyio

URL = "/api/v1/projects"
OTHER_USER_ID = uuid.UUID("00000000-0000-0000-0000-0000000000ff")


def _example(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        (package_dir() / "examples" / f"{name}.json").read_text("utf-8")
    )
    return data


@pytest.fixture
async def api(client: AsyncClient, engine: AsyncEngine, clean_db: None) -> AsyncClient:
    await seed_dev_user(engine)
    return client


async def _create(api: AsyncClient, **body: Any) -> dict[str, Any]:
    response = await api.post(URL, json={"name": "Проект", **body})
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


async def test_create_with_defaults(api: AsyncClient) -> None:
    project = await _create(api, name="  Мигалка  ")
    assert project["name"] == "Мигалка"
    assert project["board"] == "arduino-uno-r3"
    assert project["revision"] == 1
    assert project["schemaVersion"] == 1
    assert project["description"] == ""
    assert "void setup()" in project["code"]
    assert project["circuit"] == {
        "schemaVersion": 1,
        "board": {"id": "uno1", "type": "arduino-uno-r3"},
        "components": [],
        "connections": [],
    }
    assert set(project) >= {"id", "createdAt", "updatedAt"}


async def test_crud_round_trip(api: AsyncClient) -> None:
    circuit = _example("external-led")
    created = await _create(api, code="// v1", circuit=circuit)
    project_id = created["id"]

    fetched = (await api.get(f"{URL}/{project_id}")).json()
    assert fetched["circuit"] == circuit
    assert fetched["code"] == "// v1"

    response = await api.patch(
        f"{URL}/{project_id}", json={"revision": 1, "name": "Новое имя", "code": "// v2"}
    )
    assert response.status_code == 200
    updated = response.json()
    assert (updated["revision"], updated["name"], updated["code"]) == (2, "Новое имя", "// v2")
    assert updated["circuit"] == circuit
    assert updated["updatedAt"] >= created["updatedAt"]

    listing = (await api.get(URL)).json()["items"]
    assert [item["id"] for item in listing] == [project_id]
    assert "code" not in listing[0]
    assert "circuit" not in listing[0]

    assert (await api.delete(f"{URL}/{project_id}")).status_code == 204
    response = await api.get(f"{URL}/{project_id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PROJECT_NOT_FOUND"


async def test_list_sorted_by_updated_at_desc(api: AsyncClient) -> None:
    first = await _create(api, name="A")
    second = await _create(api, name="B")
    await api.patch(f"{URL}/{first['id']}", json={"revision": 1, "code": "// changed"})
    names = [item["name"] for item in (await api.get(URL)).json()["items"]]
    assert names == ["A", "B"]
    assert second["id"] != first["id"]


async def test_other_users_projects_are_not_found(api: AsyncClient, engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.execute(insert(User).values(id=OTHER_USER_ID, username="someone"))
        foreign_id = await conn.scalar(
            insert(Project)
            .values(
                owner_id=OTHER_USER_ID,
                name="чужой",
                board="arduino-uno-r3",
                circuit=project_service.empty_circuit("arduino-uno-r3"),
                schema_version=1,
            )
            .returning(Project.id)
        )
    assert (await api.get(URL)).json()["items"] == []
    for method, path, body in [
        ("GET", f"{URL}/{foreign_id}", None),
        ("PATCH", f"{URL}/{foreign_id}", {"revision": 1, "name": "x"}),
        ("DELETE", f"{URL}/{foreign_id}", None),
        ("GET", f"{URL}/{foreign_id}/revisions", None),
        ("POST", f"{URL}/{foreign_id}/validate", None),
    ]:
        response = await api.request(method, path, json=body)
        assert response.status_code == 404, (method, path)
        assert response.json()["error"]["code"] == "PROJECT_NOT_FOUND"


async def test_revision_conflict_does_not_overwrite(api: AsyncClient) -> None:
    project = await _create(api, code="// base")
    path = f"{URL}/{project['id']}"
    assert (await api.patch(path, json={"revision": 1, "code": "// tab A"})).status_code == 200

    response = await api.patch(path, json={"revision": 1, "code": "// tab B"})
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "REVISION_CONFLICT"
    assert error["details"][0]["field"] == "revision"
    current = (await api.get(path)).json()
    assert (current["code"], current["revision"]) == ("// tab A", 2)


async def test_patch_requires_revision(api: AsyncClient) -> None:
    project = await _create(api)
    response = await api.patch(f"{URL}/{project['id']}", json={"name": "x"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_noop_patch_keeps_revision(api: AsyncClient) -> None:
    project = await _create(api, name="Имя")
    response = await api.patch(f"{URL}/{project['id']}", json={"revision": 1, "name": "Имя"})
    assert response.json()["revision"] == 1


async def test_revisions_created_for_code_and_circuit_only(api: AsyncClient) -> None:
    project = await _create(api)
    path = f"{URL}/{project['id']}"
    circuit = _example("external-led")
    await api.patch(path, json={"revision": 1, "name": "Переименован"})
    await api.patch(path, json={"revision": 2, "circuit": circuit})

    revisions = (await api.get(f"{path}/revisions")).json()["items"]
    assert [item["revision"] for item in revisions] == [3, 1]

    snapshot = (await api.get(f"{path}/revisions/3")).json()
    assert snapshot["circuit"] == circuit
    assert snapshot["schemaVersion"] == 1

    response = await api.get(f"{path}/revisions/2")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "REVISION_NOT_FOUND"


async def test_revisions_are_pruned(api: AsyncClient, engine: AsyncEngine) -> None:
    project = await _create(api)
    path = f"{URL}/{project['id']}"
    total = project_service.MAX_STORED_REVISIONS + 5
    for revision in range(1, total):
        response = await api.patch(path, json={"revision": revision, "code": f"// {revision}"})
        assert response.status_code == 200

    async with engine.connect() as conn:
        stored = list(
            await conn.scalars(
                select(ProjectRevision.revision)
                .where(ProjectRevision.project_id == uuid.UUID(project["id"]))
                .order_by(ProjectRevision.revision)
            )
        )
    assert stored == list(range(total - project_service.MAX_STORED_REVISIONS + 1, total + 1))


async def test_delete_cascades_revisions(api: AsyncClient, engine: AsyncEngine) -> None:
    project = await _create(api)
    await api.delete(f"{URL}/{project['id']}")
    async with engine.connect() as conn:
        assert list(await conn.scalars(select(ProjectRevision.id))) == []


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda c: c.update(schemaVersion=2), "UNSUPPORTED_SCHEMA_VERSION"),
        (lambda c: c.pop("schemaVersion"), "INVALID_DOCUMENT"),
        (lambda c: c["components"][0].update(type="flux-capacitor"), "UNKNOWN_COMPONENT_TYPE"),
        (lambda c: c["connections"][0]["from"].update(pinId="D99"), "UNKNOWN_PIN"),
        (lambda c: c["board"].update(type="resistor"), "NOT_A_BOARD"),
    ],
)
async def test_invalid_circuit_is_rejected(api: AsyncClient, mutate: Any, code: str) -> None:
    circuit = copy.deepcopy(_example("external-led"))
    mutate(circuit)
    response = await api.post(URL, json={"name": "x", "circuit": circuit})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "INVALID_CIRCUIT"
    assert code in {detail["code"] for detail in error["details"]}

    project = await _create(api)
    response = await api.patch(f"{URL}/{project['id']}", json={"revision": 1, "circuit": circuit})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CIRCUIT"


async def test_electrical_errors_do_not_block_saving(api: AsyncClient) -> None:
    circuit = {
        "schemaVersion": 1,
        "board": {"id": "uno1", "type": "arduino-uno-r3"},
        "components": [],
        "connections": [
            {
                "id": "w1",
                "from": {"componentId": "uno1", "pinId": "5V"},
                "to": {"componentId": "uno1", "pinId": "GND1"},
            }
        ],
    }
    project = await _create(api, circuit=circuit)
    response = await api.post(f"{URL}/{project['id']}/validate")
    assert response.status_code == 200
    assert response.json()["issues"][0]["code"] == "POWER_SHORT_TO_GROUND"


async def test_unsupported_board_is_rejected(api: AsyncClient) -> None:
    response = await api.post(URL, json={"name": "x", "board": "esp32"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_empty_name_is_rejected(api: AsyncClient) -> None:
    response = await api.post(URL, json={"name": "   "})
    assert response.status_code == 422


async def test_code_size_limit(api: AsyncClient) -> None:
    response = await api.post(URL, json={"name": "x", "code": "a" * (256 * 1024 + 1)})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "SOURCE_TOO_LARGE"


async def test_missing_dev_user(client: AsyncClient, clean_db: None) -> None:
    response = await client.get(URL)
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "DEV_USER_MISSING"
    assert "seed_dev_user" in error["message"]


@pytest.fixture
async def production_client(test_database_url: str) -> AsyncIterator[AsyncClient]:
    settings = Settings(env="production", database_url=SecretStr(test_database_url))
    app = create_app(settings)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http
    await app.state.database.dispose()


async def test_production_without_auth_is_refused(
    production_client: AsyncClient, engine: AsyncEngine, clean_db: None
) -> None:
    await seed_dev_user(engine)
    response = await production_client.get(URL)
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "AUTH_NOT_CONFIGURED"


async def test_project_compile_uses_stored_code(
    test_settings: Settings, engine: AsyncEngine, clean_db: None
) -> None:
    await seed_dev_user(engine)
    sources: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sources.append(json.loads(request.content)["source"])
        return httpx.Response(503, json={"error": {"code": "COMPILER_BUSY", "message": "x"}})

    settings = test_settings.model_copy(update={"compiler_url": "http://compiler.test:8080"})
    app = create_app(settings)
    app.state.compiler = CompilerClient(settings, transport=httpx.MockTransport(handler))
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        project = await _create(http, code="// stored")
        response = await http.post(f"{URL}/{project['id']}/compile")
        assert response.json()["error"]["code"] == "COMPILER_BUSY"
        missing = await http.post(f"{URL}/{uuid.uuid4()}/compile")
        assert missing.json()["error"]["code"] == "PROJECT_NOT_FOUND"
    await app.state.compiler.aclose()
    await app.state.database.dispose()
    assert sources == ["// stored"]
