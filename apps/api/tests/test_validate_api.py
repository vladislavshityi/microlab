import json
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from microlab_api.app import create_app
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.config import Settings
from tests.conftest import CSRF_HEADERS, authenticate_as, fake_student

pytestmark = pytest.mark.anyio

URL = "/api/v1/circuits/validate"


@pytest.fixture
async def http(unreachable_settings: Settings) -> AsyncIterator[AsyncClient]:
    # Проверка схемы не требует базы данных.
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


async def test_validate_reference_circuit(http: AsyncClient) -> None:
    document = json.loads((package_dir() / "examples" / "external-led.json").read_text("utf-8"))
    response = await http.post(URL, json=document)
    assert response.status_code == 200
    body = response.json()
    assert body["issues"] == [
        {
            "code": "SPI_PINS_USED",
            "severity": "INFO",
            "message": "Pins shared with SPI are used: uno1.D13.",
            "refs": [{"kind": "pin", "id": "uno1.D13"}],
            "params": {"pins": "D13"},
        }
    ]
    assert body["nets"][0] == {"id": "NET_001", "members": ["uno1.D13", "resistor1.1"]}


async def test_validate_short_circuit(http: AsyncClient) -> None:
    document = {
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
    response = await http.post(URL, json=document)
    assert response.status_code == 200
    issue = response.json()["issues"][0]
    assert (issue["code"], issue["severity"]) == ("POWER_SHORT_TO_GROUND", "ERROR")
    assert {"kind": "net", "id": "NET_003"} in issue["refs"]


async def test_invalid_document_is_a_result_not_a_request_error(http: AsyncClient) -> None:
    response = await http.post(URL, json={"schemaVersion": 99})
    assert response.status_code == 200
    assert [i["code"] for i in response.json()["issues"]] == ["UNSUPPORTED_SCHEMA_VERSION"]


async def test_non_object_body_is_rejected(http: AsyncClient) -> None:
    response = await http.post(URL, json=[1, 2])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
