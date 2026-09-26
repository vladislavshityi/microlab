"""Полный цикл запуска с реальными воркером компиляции и сервисом симуляции.

Запуск: ``docker compose up -d --wait`` (compiler, simulator и их dev-шлюзы),
``MICROLAB_COMPILER_URL`` и ``MICROLAB_SIMULATOR_URL`` в окружении или ``.env``. Без доступных
сервисов тесты пропускаются, а при ``MICROLAB_REQUIRE_SIMULATOR=1`` (CI) — падают.
"""

import json
import os
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from microlab_api.app import create_app
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.config import Settings, get_settings
from tests.conftest import login_sync

pytestmark = pytest.mark.simulator

BLINK = """\
void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("on");
  delay(100);
  digitalWrite(13, LOW);
  Serial.println("off");
  delay(100);
}
"""


def _reachable(url: str) -> bool:
    try:
        httpx.get(f"{url.rstrip('/')}/healthz", timeout=2.0, trust_env=False)
    except httpx.HTTPError:
        return False
    return True


@pytest.fixture(scope="module")
def service_urls() -> tuple[str, str]:
    settings = get_settings()
    compiler = str(settings.compiler_url) if settings.compiler_url else None
    simulator = str(settings.simulator_url) if settings.simulator_url else None
    if (
        compiler is None
        or simulator is None
        or not _reachable(compiler)
        or not _reachable(simulator.replace("ws://", "http://", 1))
    ):
        message = "compiler or simulator is not reachable (MICROLAB_COMPILER_URL/SIMULATOR_URL)"
        if os.environ.get("MICROLAB_REQUIRE_SIMULATOR") == "1":
            pytest.fail(message)
        pytest.skip(message)
    return compiler, simulator


@pytest.fixture
def client(
    test_settings: Settings,
    seeded_db: None,
    service_urls: tuple[str, str],
) -> Iterator[TestClient]:
    compiler, simulator = service_urls
    app = create_app(
        test_settings.model_copy(update={"compiler_url": compiler, "simulator_url": simulator})
    )
    with TestClient(app, base_url="http://testserver") as http:
        login_sync(http)
        yield http


def _collect(ws: Any, until_us: int) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    while True:
        message = ws.receive_json()
        if message["type"] != "event_batch":
            continue
        events.extend(message["events"])
        if message["timestamp"] >= until_us:
            return events


def test_blink_runs_end_to_end(client: TestClient) -> None:
    circuit = json.loads((package_dir() / "examples" / "external-led.json").read_text("utf-8"))
    created = client.post(
        "/api/v1/projects", json={"name": "Blink", "code": BLINK, "circuit": circuit}
    )
    project_id = created.json()["id"]
    base = f"/api/v1/projects/{project_id}/simulation"

    with client.websocket_connect(f"/api/v1/ws/projects/{project_id}/simulation") as ws:
        assert ws.receive_json()["session"] is None
        started = client.post(f"{base}/start")
        assert started.status_code == 200, started.text
        events = _collect(ws, 450_000)
        client.post(f"{base}/stop")

    led = [
        e["payload"]["state"]["on"]
        for e in events
        if e["type"] == "component_state_changed" and e["payload"]["componentId"] == "led1"
    ]
    # Начальное состояние после подключения схемы — выключен, затем переключается каждые 100 мс.
    assert led[:5] == [False, True, False, True, False]
    serial = bytes(b for e in events if e["type"] == "serial_output" for b in e["payload"]["bytes"])
    assert serial.startswith(b"on\r\noff\r\non\r\n")
    state = client.get(base).json()["session"]
    assert state["status"] == "stopped"
