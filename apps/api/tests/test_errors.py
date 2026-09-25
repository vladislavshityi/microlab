import json
import re

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from microlab_api.app import create_app
from microlab_api.config import Settings
from microlab_api.db.database import Database

pytestmark = pytest.mark.anyio


def _add_test_routes(app: FastAPI) -> None:
    @app.get("/test/items")
    async def items(limit: int) -> dict[str, int]:
        return {"limit": limit}

    @app.get("/test/boom")
    async def boom() -> None:
        raise RuntimeError("SECRET-DETAIL password=hunter2")

    @app.get("/test/db")
    async def uses_db() -> None:
        database: Database = app.state.database
        async with database.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))


@pytest.fixture
async def app_client(test_settings: Settings) -> AsyncClient:
    app = create_app(test_settings)
    _add_test_routes(app)
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver"
    )


def _assert_envelope(body: object, code: str) -> dict[str, object]:
    assert isinstance(body, dict)
    assert set(body) == {"error"}
    error = body["error"]
    assert isinstance(error, dict)
    assert set(error) == {"code", "message", "details"}
    assert error["code"] == code
    assert isinstance(error["message"], str)
    assert error["message"]
    assert isinstance(error["details"], list)
    return error


async def test_not_found_uses_envelope(client: AsyncClient) -> None:
    response = await client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    error = _assert_envelope(response.json(), "NOT_FOUND")
    assert error["details"] == []
    assert "x-request-id" in response.headers


async def test_method_not_allowed_uses_envelope(client: AsyncClient) -> None:
    response = await client.post("/api/v1/health")

    assert response.status_code == 405
    _assert_envelope(response.json(), "METHOD_NOT_ALLOWED")
    assert response.headers["allow"] == "GET"


async def test_validation_error_uses_envelope(app_client: AsyncClient) -> None:
    async with app_client:
        invalid = await app_client.get("/test/items", params={"limit": "abc"})
        missing = await app_client.get("/test/items")

    assert invalid.status_code == 422
    error = _assert_envelope(invalid.json(), "VALIDATION_ERROR")
    assert error["message"] == "Request validation failed."
    assert error["details"] == [
        {
            "field": "query.limit",
            "message": "Input should be a valid integer, unable to parse string as an integer",
            "code": "int_parsing",
        }
    ]

    assert missing.status_code == 422
    error = _assert_envelope(missing.json(), "VALIDATION_ERROR")
    assert error["details"] == [
        {"field": "query.limit", "message": "Field required", "code": "missing"}
    ]


async def test_unhandled_exception_uses_envelope_and_logs_only_type(
    test_settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    app = create_app(test_settings)
    _add_test_routes(app)
    # raise_app_exceptions=True (по умолчанию): тест падает, если исключение выходит за
    # пределы приложения, т. е. если Starlette/uvicorn записали бы второй traceback.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as http:
        response = await http.get("/test/boom", headers={"X-Request-ID": "boom-1"})
    await app.state.database.dispose()

    assert response.status_code == 500
    error = _assert_envelope(response.json(), "INTERNAL_ERROR")
    assert error["details"] == []
    assert response.headers["x-request-id"] == "boom-1"

    output = capsys.readouterr()
    logs = output.out + output.err
    assert "SECRET-DETAIL" not in response.text
    assert "SECRET-DETAIL" not in logs
    assert "hunter2" not in logs
    assert "Traceback" not in logs
    records = [json.loads(line) for line in output.out.splitlines() if line]
    errors = [r for r in records if r["level"] == "ERROR"]
    assert errors == [
        {
            "timestamp": errors[0]["timestamp"],
            "level": "ERROR",
            "logger": "microlab_api.errors",
            "message": "unhandled exception",
            "request_id": "boom-1",
            "error_type": "RuntimeError",
            "response_started": False,
        }
    ]
    access = [r for r in records if r["message"] == "request completed"]
    assert [(r["request_id"], r["status_code"]) for r in access] == [("boom-1", 500)]


async def test_database_error_on_regular_endpoint_is_503(unreachable_settings: Settings) -> None:
    app = create_app(unreachable_settings)
    _add_test_routes(app)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        response = await http.get("/test/db")
    await app.state.database.dispose()

    assert response.status_code == 503
    _assert_envelope(response.json(), "DATABASE_UNAVAILABLE")
    assert "127.0.0.1:1" not in response.text


async def test_request_id_is_generated(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")

    assert re.fullmatch(r"[0-9a-f]{32}", response.headers["x-request-id"])


async def test_request_id_is_propagated(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health", headers={"X-Request-ID": "abc-123.DEF_4"})

    assert response.headers["x-request-id"] == "abc-123.DEF_4"


@pytest.mark.parametrize("bad_id", ["", "has space", "x" * 129, "semi;colon"])
async def test_invalid_request_id_is_replaced(client: AsyncClient, bad_id: str) -> None:
    response = await client.get("/api/v1/health", headers={"X-Request-ID": bad_id})

    assert re.fullmatch(r"[0-9a-f]{32}", response.headers["x-request-id"])


async def test_request_id_is_written_to_json_logs(
    test_settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    app = create_app(test_settings)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        await http.get("/api/v1/health", headers={"X-Request-ID": "log-me"})
    await app.state.database.dispose()

    records = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line]
    access = [r for r in records if r["message"] == "request completed"]
    assert len(access) == 1
    assert access[0]["request_id"] == "log-me"
    assert access[0]["path"] == "/api/v1/health"
    assert access[0]["status_code"] == 200
