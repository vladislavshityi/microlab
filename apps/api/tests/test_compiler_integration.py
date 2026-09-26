"""Интеграция с реальным воркером компиляции (services/compiler).

Запуск: ``docker compose up -d --wait compiler compiler-gateway`` и
``MICROLAB_COMPILER_URL=http://127.0.0.1:8081``. Без доступного воркера тесты пропускаются,
а при ``MICROLAB_REQUIRE_COMPILER=1`` (CI) — падают.
"""

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from microlab_api.app import create_app
from microlab_api.config import Settings, get_settings
from tests.conftest import CSRF_HEADERS, authenticate_as, fake_student

pytestmark = [pytest.mark.anyio, pytest.mark.compiler]

FIXTURES = Path(__file__).parent / "fixtures" / "compiler"

BLINK = """\
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(1000);
  digitalWrite(13, LOW);
  delay(1000);
}
"""


def _compiler_url() -> str | None:
    url = get_settings().compiler_url
    if url is None:
        return None
    try:
        httpx.get(f"{str(url).rstrip('/')}/healthz", timeout=2.0, trust_env=False)
    except httpx.HTTPError:
        return None
    return str(url)


@pytest.fixture(scope="module")
def compiler_url() -> str:
    url = _compiler_url()
    if url is None:
        message = "compiler worker is not reachable (MICROLAB_COMPILER_URL)"
        if os.environ.get("MICROLAB_REQUIRE_COMPILER") == "1":
            pytest.fail(message)
        pytest.skip(message)
    return url


@pytest.fixture
async def client(unreachable_settings: Settings, compiler_url: str) -> AsyncIterator[AsyncClient]:
    app = create_app(unreachable_settings.model_copy(update={"compiler_url": compiler_url}))
    authenticate_as(app, fake_student())
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(
        transport=transport, base_url="http://testserver", headers=CSRF_HEADERS
    ) as http:
        yield http
    await app.state.compiler.aclose()
    await app.state.database.dispose()


async def test_blink_compiles(client: AsyncClient) -> None:
    response = await client.post("/api/v1/compile", json={"code": BLINK}, timeout=120)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["diagnostics"] == []
    assert body["toolchain"] == {
        "arduinoCli": "1.5.1",
        "platform": "arduino:avr@1.8.8",
        "fqbn": "arduino:avr:uno",
    }
    assert body["firmware"]["format"] == "ihex"
    hex_lines = body["firmware"]["data"].splitlines()
    assert hex_lines[0].startswith(":")
    assert hex_lines[-1] == ":00000001FF"
    sizes = body["sizes"]
    assert sizes["flashMaxBytes"] == 32256
    assert sizes["ramMaxBytes"] == 2048
    assert 0 < sizes["flashBytes"] < sizes["flashMaxBytes"]


async def test_blink_firmware_is_reproducible(client: AsyncClient) -> None:
    first = await client.post("/api/v1/compile", json={"code": BLINK}, timeout=120)
    second = await client.post("/api/v1/compile", json={"code": BLINK}, timeout=120)

    assert first.json()["firmware"]["sha256"] == second.json()["firmware"]["sha256"]


async def test_syntax_error_reports_sketch_lines(client: AsyncClient) -> None:
    source = (FIXTURES / "syntax_error.ino").read_text(encoding="utf-8")
    response = await client.post("/api/v1/compile", json={"code": source}, timeout=120)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "error"
    assert body["firmware"] is None
    errors = [d for d in body["diagnostics"] if d["severity"] == "error"]
    assert [(d["file"], d["line"], d["column"]) for d in errors] == [
        ("sketch.ino", 4, 1),
        ("sketch.ino", 8, 3),
    ]


async def test_third_party_libraries_are_not_available(client: AsyncClient) -> None:
    source = (FIXTURES / "missing_library.ino").read_text(encoding="utf-8")
    response = await client.post("/api/v1/compile", json={"code": source}, timeout=120)

    body = response.json()
    assert body["status"] == "error"
    assert body["diagnostics"][0]["message"] == "Servo.h: No such file or directory"


async def test_worker_rejects_oversized_body(compiler_url: str) -> None:
    # Прямой запрос к воркеру в обход проверки API.
    payload = json.dumps({"source": "/" * (256 * 1024 + 1)})
    async with httpx.AsyncClient(base_url=compiler_url, trust_env=False) as http:
        response = await http.post(
            "/compile", content=payload, headers={"Content-Type": "application/json"}
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "SOURCE_TOO_LARGE"
