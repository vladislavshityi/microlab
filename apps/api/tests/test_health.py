import asyncio
from importlib.metadata import version

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr

from microlab_api.app import create_app
from microlab_api.config import Settings
from microlab_api.db.database import Database

pytestmark = pytest.mark.anyio


async def test_health_ok(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {
        "status": "ok",
        "version": version("microlab-api"),
        "checks": {"database": {"status": "ok"}},
    }


async def test_health_database_unavailable(
    unreachable_settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    app = create_app(unreachable_settings)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        response = await http.get("/api/v1/health")
    await app.state.database.dispose()

    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "version": version("microlab-api"),
        "checks": {"database": {"status": "error", "code": "DATABASE_UNAVAILABLE"}},
    }
    # Ни ответ, ни логи не должны раскрывать DSN или текст ошибки драйвера.
    logs = capsys.readouterr().out
    assert "database health check failed" in logs
    for secret in ("secret-password", "127.0.0.1:1", "postgresql+asyncpg"):
        assert secret not in response.text
        assert secret not in logs


async def test_ping_times_out_when_database_does_not_answer(test_settings: Settings) -> None:
    """Сервер, который принимает TCP, но не отвечает по протоколу, не должен вешать проверку."""
    connections: list[asyncio.StreamWriter] = []

    async def accept_and_stay_silent(_r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
        connections.append(w)

    server = await asyncio.start_server(accept_and_stay_silent, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    settings = test_settings.model_copy(
        update={
            "database_url": SecretStr(
                f"postgresql+asyncpg://microlab:microlab@127.0.0.1:{port}/microlab"
            )
        }
    )
    database = Database(settings)
    try:
        with pytest.raises(TimeoutError):
            await database.ping(seconds=0.2)
    finally:
        await database.dispose()
        for writer in connections:
            writer.close()
        server.close()
        await server.wait_closed()
