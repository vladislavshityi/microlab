import json
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from microlab_api.app import create_app
from microlab_api.circuit_schema.paths import definitions_dir
from microlab_api.config import Settings
from tests.conftest import CSRF_HEADERS, authenticate_as, fake_student

pytestmark = pytest.mark.anyio


@pytest.fixture
async def http(unreachable_settings: Settings) -> AsyncIterator[AsyncClient]:
    # Определения не требуют базы данных.
    app = create_app(unreachable_settings)
    authenticate_as(app, fake_student())
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(
        transport=transport,
        base_url="http://testserver",
        headers=CSRF_HEADERS,
    ) as client:
        yield client
    await app.state.database.dispose()


async def test_list_components(http: AsyncClient) -> None:
    response = await http.get("/api/v1/components")
    assert response.status_code == 200
    types = [item["type"] for item in response.json()]
    assert types == [
        "arduino-uno-r3",
        "breadboard",
        "led",
        "push-button",
        "resistor",
    ]


async def test_get_component_matches_package_json(http: AsyncClient) -> None:
    response = await http.get("/api/v1/components/led")
    assert response.status_code == 200
    expected = (definitions_dir() / "led.json").read_text(encoding="utf-8")

    assert response.json() == json.loads(expected)


async def test_get_unknown_component(http: AsyncClient) -> None:
    response = await http.get("/api/v1/components/flux-capacitor")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "UNKNOWN_COMPONENT_TYPE"
