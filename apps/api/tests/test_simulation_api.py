"""Запуск и управление симуляцией проекта с поддельными воркером компиляции и сервисом симуляции."""

import copy
import json
import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from microlab_api.app import create_app
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.config import Settings
from microlab_api.services.compiler_service import CompilerClient
from tests.conftest import login_sync
from tests.fake_supervisor import D13_HIGH, LED_ON, SERIAL, FakeSupervisor

HEX = ":00000001FF\n"
TOOLCHAIN = {"arduinoCli": "1.5.1", "platform": "arduino:avr@1.8.8", "fqbn": "arduino:avr:uno"}
SIZES = {"flashBytes": 924, "flashMaxBytes": 32256, "ramBytes": 9, "ramMaxBytes": 2048}
SYNTAX_ERROR_OUTPUT = (
    "/work/sketch/sketch.ino: In function 'void loop()':\n"
    "/work/sketch/sketch.ino:5:3: error: 'foo' was not declared in this scope\n"
)

type ClientFactory = Callable[..., TestClient]


def _external_led() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        (package_dir() / "examples" / "external-led.json").read_text("utf-8")
    )
    return data


def _short_circuit() -> dict[str, Any]:
    return {
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


@pytest.fixture
def supervisor() -> Iterator[FakeSupervisor]:
    with FakeSupervisor() as fake:
        yield fake


class CompilerStub:
    def __init__(self) -> None:
        self.success = True
        self.calls = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/compile":
            self.calls += 1
        body = {
            "success": self.success,
            "compilerOutput": "" if self.success else SYNTAX_ERROR_OUTPUT,
            "compilerOutputTruncated": False,
            "hex": HEX if self.success else None,
            "sizes": SIZES if self.success else None,
            "durationMs": 700,
            "toolchain": TOOLCHAIN,
        }
        return httpx.Response(200, json=body)


@pytest.fixture
def compiler_stub() -> CompilerStub:
    return CompilerStub()


@pytest.fixture
def make_client(
    test_settings: Settings,
    seeded_db: None,
    supervisor: FakeSupervisor,
    compiler_stub: CompilerStub,
) -> Iterator[ClientFactory]:
    clients: list[TestClient] = []

    def factory(**overrides: Any) -> TestClient:
        settings = test_settings.model_copy(
            update={
                "compiler_url": "http://compiler.test:8080",
                "simulator_url": supervisor.url,
                **overrides,
            }
        )
        app = create_app(settings)
        app.state.compiler = CompilerClient(settings, transport=httpx.MockTransport(compiler_stub))
        client = TestClient(app, base_url="http://testserver")
        client.__enter__()
        login_sync(client)
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


def _create_project(client: TestClient, circuit: dict[str, Any] | None = None) -> str:
    response = client.post(
        "/api/v1/projects",
        json={"name": "Мигалка", "code": "void setup(){}\nvoid loop(){}\n", "circuit": circuit},
    )
    assert response.status_code == 201, response.text
    project_id: str = response.json()["id"]
    return project_id


def _url(project_id: str, command: str) -> str:
    return f"/api/v1/projects/{project_id}/simulation/{command}"


def _ws(project_id: str) -> str:
    return f"/api/v1/ws/projects/{project_id}/simulation"


def test_start_validates_compiles_and_starts(
    make_client: ClientFactory, supervisor: FakeSupervisor, compiler_stub: CompilerStub
) -> None:
    client = make_client()
    project_id = _create_project(client, _external_led())

    response = client.post(_url(project_id, "start"))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["session"]["status"] == "running"
    assert body["session"]["projectId"] == project_id
    assert body["compilation"]["status"] == "success"
    assert body["compilation"]["sizes"] == SIZES
    # Прошивка уходит только в сервис симуляции.
    assert body["compilation"]["firmware"] is None
    assert all(issue["severity"] != "ERROR" for issue in body["validation"]["issues"])
    assert compiler_stub.calls == 1

    start = supervisor.received[0]
    assert start["type"] == "start"
    assert start["firmwareHex"] == HEX
    assert start["simulationId"] == body["session"]["simulationId"]
    assert start["projectId"] == project_id
    circuit = start["circuit"]
    assert circuit["board"] == {"id": "uno1", "type": "arduino-uno-r3"}
    assert {"id": "NET_001", "members": ["uno1.D13", "resistor1.1"]} in circuit["netlist"]
    assert circuit["components"] == [
        {"id": "resistor1", "type": "resistor", "properties": {"resistanceOhms": 220}},
        {"id": "led1", "type": "led", "properties": {"color": "red"}},
    ]


def test_circuit_errors_block_compilation(
    make_client: ClientFactory, supervisor: FakeSupervisor, compiler_stub: CompilerStub
) -> None:
    client = make_client()
    project_id = _create_project(client, _short_circuit())

    response = client.post(_url(project_id, "start"))

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "CIRCUIT_HAS_ERRORS"
    assert body["error"]["details"][0]["code"] == "POWER_SHORT_TO_GROUND"
    assert body["validation"]["issues"][0]["severity"] == "ERROR"
    assert compiler_stub.calls == 0
    assert supervisor.received == []


def test_compilation_failure_blocks_simulation(
    make_client: ClientFactory, supervisor: FakeSupervisor, compiler_stub: CompilerStub
) -> None:
    compiler_stub.success = False
    client = make_client()
    project_id = _create_project(client, _external_led())

    response = client.post(_url(project_id, "start"))

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "COMPILATION_FAILED"
    assert body["error"]["details"] == [
        {
            "field": "sketch:5:3",
            "message": "'foo' was not declared in this scope",
            "code": "error",
        }
    ]
    diagnostic = body["compilation"]["diagnostics"][0]
    assert (diagnostic["line"], diagnostic["column"], diagnostic["severity"]) == (5, 3, "error")
    assert supervisor.received == []


def test_simulator_not_configured(make_client: ClientFactory) -> None:
    client = make_client(simulator_url=None)
    project_id = _create_project(client, _external_led())

    response = client.post(_url(project_id, "start"))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SIMULATOR_UNAVAILABLE"


def test_simulator_unreachable(make_client: ClientFactory) -> None:
    client = make_client(simulator_url="ws://127.0.0.1:1")
    project_id = _create_project(client, _external_led())

    response = client.post(_url(project_id, "start"))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SIMULATOR_UNAVAILABLE"
    state = client.get(f"/api/v1/projects/{project_id}/simulation").json()["session"]
    assert (state["status"], state["errorCode"]) == ("failed", "SIMULATOR_UNAVAILABLE")


def test_simulator_busy(make_client: ClientFactory, supervisor: FakeSupervisor) -> None:
    supervisor.start_error = "SIMULATOR_BUSY"
    client = make_client()
    project_id = _create_project(client, _external_led())

    response = client.post(_url(project_id, "start"))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SIMULATOR_BUSY"


def test_invalid_firmware_is_start_failure(
    make_client: ClientFactory, supervisor: FakeSupervisor
) -> None:
    supervisor.start_error = "INVALID_FIRMWARE"
    client = make_client()
    project_id = _create_project(client, _external_led())

    response = client.post(_url(project_id, "start"))

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "SIMULATION_START_FAILED"
    assert error["details"][0]["code"] == "INVALID_FIRMWARE"


@pytest.mark.parametrize("command", ["pause", "resume", "stop", "reset"])
def test_commands_without_session(make_client: ClientFactory, command: str) -> None:
    client = make_client()
    project_id = _create_project(client)

    response = client.post(_url(project_id, command))

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SIMULATION_NOT_RUNNING"


def test_unknown_project(make_client: ClientFactory) -> None:
    client = make_client()
    response = client.post(_url("00000000-0000-0000-0000-00000000abcd", "start"))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PROJECT_NOT_FOUND"


def test_lifecycle_commands_and_inputs(
    make_client: ClientFactory, supervisor: FakeSupervisor
) -> None:
    client = make_client()
    project_id = _create_project(client, _external_led())
    assert client.post(_url(project_id, "start")).status_code == 200

    paused = client.post(_url(project_id, "pause"))
    assert paused.status_code == 200
    assert paused.json()["session"]["status"] == "paused"
    assert client.post(_url(project_id, "resume")).json()["session"]["status"] == "running"
    assert client.post(_url(project_id, "reset")).status_code == 200

    pressed = client.post(
        _url(project_id, "input"), json={"componentId": "button1", "input": {"pressed": True}}
    )
    assert pressed.status_code == 200
    assert pressed.json()["appliedCycle"] == 320_000
    unknown = client.post(
        _url(project_id, "input"), json={"componentId": "nope", "input": {"pressed": True}}
    )
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "INVALID_SIMULATION_INPUT"
    bad_shape = client.post(
        _url(project_id, "input"), json={"componentId": "button1", "input": {"angle": 3}}
    )
    assert bad_shape.status_code == 422
    assert bad_shape.json()["error"]["code"] == "VALIDATION_ERROR"

    serial = client.post(_url(project_id, "serial"), json={"data": "привет\n"})
    assert serial.status_code == 200
    too_long = client.post(_url(project_id, "serial"), json={"data": "я" * 3000})
    assert too_long.status_code == 422

    stopped = client.post(_url(project_id, "stop"))
    assert stopped.status_code == 200
    session = stopped.json()["session"]
    assert session["status"] == "stopped"
    assert session["endTime"] is not None
    assert client.post(_url(project_id, "stop")).status_code == 409

    assert supervisor.commands() == [
        "start",
        "pause",
        "resume",
        "reset",
        "set_component_input",
        "set_component_input",
        "serial_input",
        "stop",
    ]
    assert supervisor.received[4]["input"] == {"pressed": True}
    assert supervisor.received[6]["data"] == "привет\n"


def test_potentiometer_and_illuminance_inputs(
    make_client: ClientFactory, supervisor: FakeSupervisor
) -> None:
    client = make_client()
    project_id = _create_project(client, _external_led())
    assert client.post(_url(project_id, "start")).status_code == 200

    for body in ({"position": 0.25}, {"illuminanceLux": 350}):
        response = client.post(
            _url(project_id, "input"), json={"componentId": "button1", "input": body}
        )
        assert response.status_code == 200
    for body in ({"position": 1.5}, {"illuminanceLux": 0}, {"illuminanceLux": 200_000}):
        response = client.post(
            _url(project_id, "input"), json={"componentId": "button1", "input": body}
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    inputs = [c["input"] for c in supervisor.received if c.get("type") == "set_component_input"]
    assert inputs == [{"position": 0.25}, {"illuminanceLux": 350.0}]


def test_restart_replaces_active_session(
    make_client: ClientFactory, supervisor: FakeSupervisor
) -> None:
    client = make_client()
    project_id = _create_project(client, _external_led())
    first = client.post(_url(project_id, "start")).json()["session"]["simulationId"]
    second = client.post(_url(project_id, "start")).json()["session"]["simulationId"]

    assert first != second
    assert supervisor.commands() == ["start", "stop", "start"]
    state = client.get(f"/api/v1/projects/{project_id}/simulation").json()["session"]
    assert (state["simulationId"], state["status"]) == (second, "running")


def test_websocket_streams_batches_and_snapshots(make_client: ClientFactory) -> None:
    client = make_client()
    project_id = _create_project(client, _external_led())

    with client.websocket_connect(_ws(project_id)) as ws:
        initial = ws.receive_json()
        assert initial == {
            "version": 1,
            "type": "session_state",
            "session": None,
            "events": [],
            "serialTail": [],
        }
        assert client.post(_url(project_id, "start")).status_code == 200
        state = ws.receive_json()
        assert (state["type"], state["session"]["status"]) == ("session_state", "starting")
        started = ws.receive_json()
        assert started["type"] == "event_batch"
        assert started["events"][0]["type"] == "simulation_started"
        batch = ws.receive_json()
        # Пачка пересылается без изменений.
        assert batch["events"] == [D13_HIGH, LED_ON, SERIAL]

        # Вторая вкладка сразу получает текущее состояние.
        with client.websocket_connect(_ws(project_id)) as second:
            snapshot = second.receive_json()
            assert snapshot["session"]["status"] == "running"
            assert snapshot["events"] == [D13_HIGH, LED_ON]
            assert snapshot["serialTail"] == [104, 105, 10]

        client.post(_url(project_id, "stop"))
        stopped = ws.receive_json()
        assert stopped["events"][0]["type"] == "simulation_stopped"


def test_simulator_disconnect_ends_session(
    make_client: ClientFactory, supervisor: FakeSupervisor
) -> None:
    client = make_client()
    project_id = _create_project(client, _external_led())

    with client.websocket_connect(_ws(project_id)) as ws:
        ws.receive_json()
        client.post(_url(project_id, "start"))
        for _ in range(3):
            ws.receive_json()
        supervisor.drop_connections()
        lost = ws.receive_json()
        assert [event["type"] for event in lost["events"]] == [
            "simulation_error",
            "simulation_stopped",
        ]
        assert lost["events"][0]["payload"]["code"] == "SIMULATOR_UNAVAILABLE"

    state = client.get(f"/api/v1/projects/{project_id}/simulation").json()["session"]
    assert (state["status"], state["errorCode"]) == ("failed", "SIMULATOR_UNAVAILABLE")


def test_session_without_subscribers_stops_after_idle_timeout(
    make_client: ClientFactory, supervisor: FakeSupervisor
) -> None:
    client = make_client(simulation_idle_timeout_seconds=0.2)
    project_id = _create_project(client, _external_led())
    client.post(_url(project_id, "start"))

    deadline = time.monotonic() + 5
    status = "running"
    while status == "running" and time.monotonic() < deadline:
        time.sleep(0.05)
        status = client.get(f"/api/v1/projects/{project_id}/simulation").json()["session"]["status"]

    assert status == "stopped"
    assert supervisor.commands() == ["start", "stop"]


def test_subscriber_keeps_session_alive(
    make_client: ClientFactory, supervisor: FakeSupervisor
) -> None:
    client = make_client(simulation_idle_timeout_seconds=0.2)
    project_id = _create_project(client, _external_led())

    with client.websocket_connect(_ws(project_id)) as ws:
        ws.receive_json()
        client.post(_url(project_id, "start"))
        time.sleep(0.5)
        state = client.get(f"/api/v1/projects/{project_id}/simulation").json()["session"]
        assert state["status"] == "running"
    assert supervisor.commands() == ["start"]


def test_websocket_unknown_project_is_closed(make_client: ClientFactory) -> None:
    client = make_client()
    with (
        client.websocket_connect(_ws("00000000-0000-0000-0000-00000000abcd")) as ws,
        pytest.raises(WebSocketDisconnect) as closed,
    ):
        ws.receive_json()
    assert closed.value.code == 4404


def test_websocket_rejects_foreign_origin(make_client: ClientFactory) -> None:
    client = make_client()
    project_id = _create_project(client)
    with (
        pytest.raises(WebSocketDisconnect) as closed,
        client.websocket_connect(_ws(project_id), headers={"Origin": "https://evil.example"}),
    ):
        pass
    assert closed.value.code == 1008


def test_start_payload_does_not_mutate_stored_circuit(make_client: ClientFactory) -> None:
    client = make_client()
    circuit = _external_led()
    project_id = _create_project(client, copy.deepcopy(circuit))
    client.post(_url(project_id, "start"))
    stored = client.get(f"/api/v1/projects/{project_id}").json()["circuit"]
    assert stored == circuit


def test_websocket_requires_session(make_client: ClientFactory) -> None:
    client = make_client()
    project_id = _create_project(client)
    client.cookies.clear()
    with (
        client.websocket_connect(_ws(project_id)) as ws,
        pytest.raises(WebSocketDisconnect) as closed,
    ):
        ws.receive_json()
    assert closed.value.code == 4401


def test_second_project_replaces_users_running_simulation(make_client: ClientFactory) -> None:
    client = make_client()
    first = _create_project(client, _external_led())
    second = _create_project(client, _external_led())
    assert client.post(f"/api/v1/projects/{first}/simulation/start").status_code == 200
    assert client.post(f"/api/v1/projects/{second}/simulation/start").status_code == 200
    assert client.get(f"/api/v1/projects/{first}/simulation").json()["session"]["status"] == (
        "stopped"
    )
    assert client.get(f"/api/v1/projects/{second}/simulation").json()["session"]["status"] == (
        "running"
    )
