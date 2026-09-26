"""Состояние сессии по пачкам событий, преобразование ошибок и описание схемы для worker."""

import json
import uuid

import pytest

from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.domain.circuit import build_netlist, parse_circuit
from microlab_api.domain.simulation.circuit_payload import build_circuit_payload
from microlab_api.schemas.errors import ErrorCode
from microlab_api.services.simulation_service import (
    SERIAL_TAIL_BYTES,
    SimulationSession,
    map_supervisor_error,
    session_state_message,
)
from tests.fake_supervisor import D13_HIGH, LED_ON, batch, event


def _session() -> tuple[SimulationSession, list[str]]:
    published: list[str] = []
    session = SimulationSession(
        project_id=uuid.uuid4(), simulation_id="sim-1", publish=published.append
    )
    return session, published


def _feed(session: SimulationSession, cycle: int, events: list[dict[str, object]]) -> str:
    raw = json.dumps(batch(cycle, events))
    session.handle_message(raw, json.loads(raw))
    return raw


def test_batches_update_status_and_latest_state() -> None:
    session, published = _session()
    raw = _feed(session, 0, [event("simulation_started", 0, {}), D13_HIGH, LED_ON])
    low = event("digital_pin_changed", 320_000, {"pin": "D13", "mode": "output-low", "value": 0})
    _feed(session, 320_000, [low])

    assert published[0] == raw
    assert session.status == "running"
    assert session.info().timestamp == 20_000
    assert list(session.latest.values()) == [LED_ON, low]

    _feed(session, 400_000, [event("simulation_paused", 400_000, {"reason": "cpu_halted"})])
    assert session.info().status == "paused"
    _feed(session, 400_000, [event("simulation_reset", 400_000, {})])
    assert session.latest == {}


def test_serial_tail_is_bounded() -> None:
    session, _ = _session()
    for _ in range(3):
        chunk = event("serial_output", 0, {"port": "Serial", "bytes": [65] * 2000})
        _feed(session, 0, [chunk])
    assert len(session.serial_tail) == SERIAL_TAIL_BYTES
    snapshot = json.loads(session_state_message(session))
    assert len(snapshot["serialTail"]) == SERIAL_TAIL_BYTES


@pytest.mark.anyio
async def test_worker_failure_marks_session_failed() -> None:
    session, _ = _session()
    _feed(session, 0, [event("simulation_started", 0, {})])
    error = event("simulation_error", 16, {"code": "WORKER_EXITED", "severity": "error"})
    stopped = event("simulation_stopped", 16, {"reason": "worker_failed"})
    _feed(session, 16, [error, stopped])
    assert (session.status, session.error_code) == ("failed", "WORKER_EXITED")
    assert session.end_time is not None


@pytest.mark.anyio
async def test_cpu_halt_error_does_not_end_session() -> None:
    session, _ = _session()
    _feed(session, 0, [event("simulation_started", 0, {})])
    halt = event("simulation_error", 16, {"code": "INVALID_OPCODE", "severity": "error", "pc": 4})
    _feed(session, 16, [halt, event("simulation_paused", 16, {"reason": "cpu_halted"})])
    assert (session.status, session.error_code) == ("paused", None)


@pytest.mark.parametrize(
    ("code", "starting", "status", "api_code"),
    [
        ("SIMULATOR_BUSY", True, 503, ErrorCode.SIMULATOR_BUSY),
        ("WORKER_START_FAILED", True, 503, ErrorCode.SIMULATOR_UNAVAILABLE),
        ("INVALID_FIRMWARE", True, 502, ErrorCode.SIMULATION_START_FAILED),
        ("NOT_RUNNING", False, 409, ErrorCode.SIMULATION_NOT_RUNNING),
        ("NOT_PAUSED", False, 409, ErrorCode.SIMULATION_NOT_RUNNING),
        ("UNSUPPORTED_INPUT", False, 422, ErrorCode.INVALID_SIMULATION_INPUT),
        ("WORKER_TIMEOUT", False, 503, ErrorCode.SIMULATOR_UNAVAILABLE),
    ],
)
def test_supervisor_error_mapping(
    code: str, starting: bool, status: int, api_code: ErrorCode
) -> None:
    error = map_supervisor_error(code, "x", starting=starting)
    assert (error.status_code, error.code) == (status, api_code)


def test_circuit_payload_uses_validation_netlist() -> None:
    raw = json.loads((package_dir() / "examples" / "breadboard-led.json").read_text("utf-8"))
    document = parse_circuit(raw).document
    assert document is not None
    registry = get_definition_registry()
    nets = build_netlist(document, registry)

    payload = build_circuit_payload(document, nets, registry)

    assert payload["board"] == {"id": document.board.id, "type": "arduino-uno-r3"}
    assert payload["netlist"] == [{"id": n.id, "members": list(n.members)} for n in nets]
    assert [c["id"] for c in payload["components"]] == [c.id for c in document.components]
