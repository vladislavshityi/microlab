"""Супервизор сессий симуляции MicroLab.

Принимает WebSocket-подключения от backend (внутренняя сеть, без аутентификации) и для каждой
сессии запускает отдельный процесс ``microlab-sim-worker`` (JSON-lines протокол версии 1).
Супервизор задаёт темп симуляции: выполняет прошивку срезами ``run_for`` фиксированной длины и
ждёт, пока настенное время × скорость не догонит симулированное.

Протокол клиента (версия 1), одно JSON-сообщение на WebSocket-кадр:

* клиент → супервизор: ``{"type": <команда>, "id": <необязательно>, ...}``; команды ``start``
  (``firmwareHex``, ``circuit`` {board, netlist, components} — необязательно, ``speed`` — 1.0,
  ``simulationId``/``projectId`` — только для журнала), ``pause``, ``resume``, ``stop``, ``reset``,
  ``set_component_input`` (``componentId``, ``input``), ``serial_input`` (``bytes`` или ``data``);
* супервизор → клиент: ответ на каждую команду
  ``{"version":1,"type":"response","id":…,"ok":true,"result":{…}}`` (или ``ok: false`` и
  ``error: {code, message}``) и пачки событий ``{"version":1,"type":"event_batch","timestamp":…,
  "cycle":…,"events":[…]}``.

Время событий: ``timestamp`` — микросекунды симулированного времени от включения питания
(такт 16 MHz / 16, с округлением вниз), ``cycle`` — точный номер такта. Процесс worker новый в
каждой сессии, поэтому отсчёт начинается с нуля.

Детерминизм: срез имеет фиксированную длину в тактах, а все воздействия клиента (reset, кнопки,
вход Serial) применяются только на границе среза — то есть квантуются до длительности среза
(по умолчанию 10 мс; граница — первый такт после кратного длине среза, с перебегом не более
длительности одной инструкции). Такт применения возвращается в ответе (``result.cycle``), поэтому сессию
можно воспроизвести, повторив команды на тех же тактах.

Ограничение потока событий (на одну пачку = один срез): вывод Serial объединяется в одно событие
``serial_output`` с массивом ``bytes`` и ограничен по скорости в симулированном времени; прочие
события сверх лимита сворачиваются до последнего значения на вывод/компонент. В обоих случаях
один раз за сессию выдаётся предупреждение ``simulation_error``.

Изоляция: отдельный процесс на сессию с лимитами ``prlimit`` (CPU, адресное пространство,
запрет записи файлов и порождения процессов), пустым окружением и собственной сессией процессов;
процесс уничтожается при stop, отключении клиента, простое и превышении длительности сессии.

Выбор Python (stdlib + websockets) вместо отдельного async-стека на Rust: тот же подход, что у
воркера компиляции, одна зависимость без транзитивных, а горячий цикл эмуляции остаётся в Rust —
супервизор лишь пересылает события и спит между срезами.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import signal
import sys
import time
import uuid
from datetime import UTC, datetime
from http import HTTPStatus
from typing import Any

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


def _env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


PROTOCOL_VERSION = 1
CLOCK_HZ = 16_000_000
CYCLES_PER_US = CLOCK_HZ // 1_000_000

PORT = _env_int("SIM_PORT", 8080)
WORKER_PATH = os.environ.get("SIM_WORKER", "/usr/local/bin/microlab-sim-worker")
# Пустая строка отключает prlimit (локальный запуск тестов вне Linux).
PRLIMIT = os.environ.get("SIM_PRLIMIT", "/usr/bin/prlimit")

MAX_SESSIONS = _env_int("SIM_MAX_SESSIONS", 8)
MAX_CONNECTIONS = _env_int("SIM_MAX_CONNECTIONS", 32)
MAX_SESSION_SECONDS = _env_float("SIM_MAX_SESSION_SECONDS", 1800)
IDLE_TIMEOUT_SECONDS = _env_float("SIM_IDLE_TIMEOUT_SECONDS", 300)
SLICE_MS = _env_int("SIM_SLICE_MS", 10)
SLICE_CYCLES = SLICE_MS * CLOCK_HZ // 1000
# Пачка без событий всё равно отправляется не реже этого интервала (ход симулированного времени).
TICK_SECONDS = _env_float("SIM_TICK_SECONDS", 0.1)
# Отставание от реального времени, после которого отсчёт темпа сбрасывается.
MAX_LAG_SECONDS = _env_float("SIM_MAX_LAG_SECONDS", 1.0)
WORKER_CALL_TIMEOUT_SECONDS = _env_float("SIM_WORKER_CALL_TIMEOUT_SECONDS", 10)
MAX_EVENTS_PER_BATCH = _env_int("SIM_MAX_EVENTS_PER_BATCH", 256)
MAX_SERIAL_BYTES_PER_SECOND = _env_int("SIM_MAX_SERIAL_BYTES_PER_SECOND", 32 * 1024)
MIN_SPEED, MAX_SPEED = 0.1, 10.0

MAX_MESSAGE_BYTES = 512 * 1024
MAX_HEX_CHARS = 256 * 1024
# Строка stdout worker (самая длинная — ответ get_state, который супервизор не использует).
MAX_WORKER_LINE = 1024 * 1024

# Лимиты процесса worker. CPU — с запасом над максимальной длительностью сессии.
WORKER_LIMITS = (
    f"--cpu={int(MAX_SESSION_SECONDS) + 60}",
    f"--as={_env_int('SIM_LIMIT_AS_BYTES', 256 * 1024**2)}",
    "--fsize=0",
    "--nofile=16",
    "--nproc=1",
    "--core=0",
)

_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

logger = logging.getLogger("simulator")
_active_sessions = 0
_connections = 0


class CommandError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class WorkerFailure(Exception):
    """Worker завершился, завис или нарушил протокол."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _event(kind: str, cycle: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": PROTOCOL_VERSION,
        "type": kind,
        "timestamp": cycle // CYCLES_PER_US,
        "cycle": cycle,
        "payload": payload,
    }


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


class EventSink:
    """Собирает события одного среза в пачку с учётом лимитов."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.events: list[dict[str, Any]] = []
        self.count = 0
        self.overflow: dict[tuple[str, str], dict[str, Any]] = {}
        self.serial_budget = max(1, MAX_SERIAL_BYTES_PER_SECOND * SLICE_MS // 1000)
        self._serial: dict[str, Any] | None = None

    def add(self, ev: dict[str, Any]) -> None:
        cycle = ev.get("timestamp")
        if not isinstance(cycle, int):
            cycle = self.session.cycle
        ev["timestamp"] = cycle // CYCLES_PER_US
        ev["cycle"] = cycle
        kind = ev.get("type")
        payload = ev.get("payload") or {}
        if kind == "serial_output":
            self._add_serial(ev, payload)
            return
        self._serial = None
        if self.count < MAX_EVENTS_PER_BATCH:
            self.events.append(ev)
            self.count += 1
            return
        # Сверх лимита остаётся только последнее событие на вывод/компонент/код.
        key = str(payload.get("pin") or payload.get("componentId") or payload.get("code") or "")
        self.overflow.pop((str(kind), key), None)
        self.overflow[(str(kind), key)] = ev

    def _add_serial(self, ev: dict[str, Any], payload: dict[str, Any]) -> None:
        if self.serial_budget <= 0:
            self.session.serial_dropped += 1
            return
        self.serial_budget -= 1
        byte = payload.get("byte")
        if self._serial is not None and self._serial["payload"]["port"] == payload.get("port"):
            self._serial["payload"]["bytes"].append(byte)
            return
        ev["payload"] = {"port": payload.get("port", "Serial"), "bytes": [byte]}
        self._serial = ev
        self.events.append(ev)

    def finish(self) -> list[dict[str, Any]]:
        s = self.session
        if self.overflow:
            self.events.extend(self.overflow.values())
            if not s.warned_rate:
                s.warned_rate = True
                self.events.append(
                    _event(
                        "simulation_error",
                        s.cycle,
                        {
                            "code": "EVENT_RATE_LIMITED",
                            "severity": "warning",
                            "message": "too many events per time slice; intermediate states were coalesced",
                        },
                    )
                )
        if s.serial_dropped and not s.warned_serial:
            s.warned_serial = True
            self.events.append(
                _event(
                    "simulation_error",
                    s.cycle,
                    {
                        "code": "SERIAL_OUTPUT_RATE_LIMITED",
                        "severity": "warning",
                        "message": "serial output exceeds the forwarding limit; excess bytes are dropped",
                        "limitBytesPerSecond": MAX_SERIAL_BYTES_PER_SECOND,
                    },
                )
            )
        return self.events


class Worker:
    """Процесс microlab-sim-worker: одна команда за раз, ответ и события из stdout."""

    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self.proc = proc
        self.lock = asyncio.Lock()

    @classmethod
    async def spawn(cls) -> Worker:
        argv = [PRLIMIT, *WORKER_LIMITS, "--", WORKER_PATH] if PRLIMIT else [WORKER_PATH]
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env={},
            cwd="/",
            start_new_session=True,
            limit=MAX_WORKER_LINE,
        )
        return cls(proc)

    async def call(self, cmd: dict[str, Any], sink: EventSink | None) -> dict[str, Any]:
        async with self.lock:
            try:
                return await asyncio.wait_for(self._call(cmd, sink), WORKER_CALL_TIMEOUT_SECONDS)
            except TimeoutError:
                self.kill()
                raise WorkerFailure("WORKER_TIMEOUT", "simulation worker did not respond") from None

    async def _call(self, cmd: dict[str, Any], sink: EventSink | None) -> dict[str, Any]:
        assert self.proc.stdin is not None and self.proc.stdout is not None
        try:
            self.proc.stdin.write(json.dumps(cmd, separators=(",", ":")).encode() + b"\n")
            await self.proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            raise WorkerFailure("WORKER_EXITED", "simulation worker exited") from None
        while True:
            try:
                line = await self.proc.stdout.readline()
            except (ValueError, asyncio.LimitOverrunError):
                self.kill()
                raise WorkerFailure(
                    "WORKER_PROTOCOL_ERROR", "worker output line too long"
                ) from None
            if not line:
                raise WorkerFailure("WORKER_EXITED", "simulation worker exited")
            try:
                msg: dict[str, Any] = json.loads(line)
            except json.JSONDecodeError:
                msg = {}
            if not isinstance(msg, dict) or not msg:
                self.kill()
                raise WorkerFailure("WORKER_PROTOCOL_ERROR", "invalid worker output")
            if msg.get("type") == "response":
                return msg
            if sink is not None:
                sink.add(msg)

    def kill(self) -> None:
        # Worker запущен в собственной сессии: группа процессов совпадает с его pid.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(self.proc.pid, signal.SIGKILL)
        with contextlib.suppress(ProcessLookupError):
            self.proc.kill()

    async def close(self) -> int | None:
        self.kill()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self.proc.wait(), 5)
        return self.proc.returncode


class Session:
    """Одно WebSocket-подключение; в каждый момент — не более одного worker."""

    def __init__(self, ws: ServerConnection) -> None:
        self.ws = ws
        self.cmd_lock = asyncio.Lock()
        self.worker: Worker | None = None
        self.state = "idle"  # idle | running | paused | stopped
        self.speed = 1.0
        self.cycle = 0
        self.base_wall = 0.0
        self.base_cycle = 0
        self.started_wall = 0.0
        self.last_client_msg = time.monotonic()
        self.last_sent = 0.0
        self.pacer: asyncio.Task[None] | None = None
        self.generation = 0
        self.simulation_id = ""
        self.project_id: str | None = None
        self.start_time = ""
        self.serial_dropped = 0
        self.warned_rate = False
        self.warned_serial = False
        self.warned_lag = False

    # --- отправка ---

    async def send(self, msg: dict[str, Any]) -> None:
        with contextlib.suppress(ConnectionClosed):
            await self.ws.send(json.dumps(msg, separators=(",", ":")))

    async def send_batch(self, events: list[dict[str, Any]], force: bool = False) -> None:
        now = time.monotonic()
        if not events and not force and now - self.last_sent < TICK_SECONDS:
            return
        self.last_sent = now
        await self.send(
            {
                "version": PROTOCOL_VERSION,
                "type": "event_batch",
                "timestamp": self.cycle // CYCLES_PER_US,
                "cycle": self.cycle,
                "events": events,
            }
        )

    async def respond(self, msg_id: Any, result: dict[str, Any]) -> None:
        await self.send(
            {
                "version": PROTOCOL_VERSION,
                "type": "response",
                "id": msg_id,
                "ok": True,
                "result": result,
            }
        )

    async def respond_error(self, msg_id: Any, code: str, message: str) -> None:
        await self.send(
            {
                "version": PROTOCOL_VERSION,
                "type": "response",
                "id": msg_id,
                "ok": False,
                "error": {"code": code, "message": message},
            }
        )

    # --- команды ---

    async def handle(self, raw: str | bytes) -> None:
        self.last_client_msg = time.monotonic()
        msg_id: Any = None
        try:
            if not isinstance(raw, str):
                raise CommandError("INVALID_MESSAGE", "messages must be JSON text frames")
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                raise CommandError("INVALID_MESSAGE", "message is not valid JSON") from None
            if not isinstance(msg, dict):
                raise CommandError("INVALID_MESSAGE", "message must be a JSON object")
            msg_id = msg.get("id")
            handler = {
                "start": self.cmd_start,
                "pause": self.cmd_pause,
                "resume": self.cmd_resume,
                "stop": self.cmd_stop,
                "reset": self.cmd_reset,
                "set_component_input": self.cmd_component_input,
                "serial_input": self.cmd_serial_input,
            }.get(str(msg.get("type")))
            if handler is None:
                raise CommandError("UNKNOWN_COMMAND", f"unknown command {msg.get('type')!r}")
            async with self.cmd_lock:
                result = await handler(msg)
            await self.respond(msg_id, result)
        except CommandError as e:
            await self.respond_error(msg_id, e.code, e.message)
        except WorkerFailure as e:
            await self.respond_error(msg_id, e.code, e.message)
            await self.fail(e)

    def _require_worker(self) -> Worker:
        if self.worker is None:
            raise CommandError("NOT_STARTED", "simulation is not started")
        return self.worker

    async def _worker_call(
        self, cmd: dict[str, Any]
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        worker = self._require_worker()
        sink = EventSink(self)
        resp = await worker.call(cmd, sink)
        result = resp.get("result") or {}
        if isinstance(result.get("cycle"), int):
            self.cycle = result["cycle"]
        return resp, sink.finish()

    async def cmd_start(self, msg: dict[str, Any]) -> dict[str, Any]:
        global _active_sessions
        if self.worker is not None:
            raise CommandError("ALREADY_STARTED", "simulation is already started")
        hex_text = msg.get("firmwareHex")
        if not isinstance(hex_text, str) or not hex_text:
            raise CommandError("INVALID_ARGUMENT", "firmwareHex (string) is required")
        if len(hex_text) > MAX_HEX_CHARS:
            raise CommandError("INVALID_ARGUMENT", "firmwareHex is too large")
        circuit = msg.get("circuit")
        if circuit is not None and not isinstance(circuit, dict):
            raise CommandError("INVALID_ARGUMENT", "circuit must be an object")
        speed = msg.get("speed", 1.0)
        if (
            isinstance(speed, bool)
            or not isinstance(speed, (int, float))
            or not MIN_SPEED <= speed <= MAX_SPEED
        ):
            raise CommandError(
                "INVALID_ARGUMENT", f"speed must be between {MIN_SPEED} and {MAX_SPEED}"
            )
        sim_id = msg.get("simulationId")
        if sim_id is not None and (not isinstance(sim_id, str) or not _ID_RE.match(sim_id)):
            raise CommandError("INVALID_ARGUMENT", "simulationId must match [A-Za-z0-9_.:-]{1,64}")
        project_id = msg.get("projectId")
        if project_id is not None and (
            not isinstance(project_id, str) or not _ID_RE.match(project_id)
        ):
            raise CommandError("INVALID_ARGUMENT", "projectId must match [A-Za-z0-9_.:-]{1,64}")
        if _active_sessions >= MAX_SESSIONS:
            raise CommandError("SIMULATOR_BUSY", "all simulation slots are in use; try again later")

        _active_sessions += 1
        self.simulation_id = sim_id or str(uuid.uuid4())
        self.project_id = project_id
        self.start_time = _now_iso()
        self.speed = float(speed)
        self.cycle = 0
        self.serial_dropped = 0
        self.warned_rate = self.warned_serial = self.warned_lag = False
        try:
            self.worker = await Worker.spawn()
        except OSError:
            _active_sessions -= 1
            logger.exception("worker spawn failed")
            raise CommandError(
                "WORKER_START_FAILED", "simulation worker could not be started"
            ) from None
        self.state = "paused"
        self.started_wall = time.monotonic()

        resp, events = await self._worker_call({"cmd": "load_firmware", "hex": hex_text})
        if not resp.get("ok"):
            err = resp.get("error") or {}
            await self.terminate("failed", str(err.get("code")), notify=False)
            raise CommandError(
                str(err.get("code", "INVALID_FIRMWARE")), str(err.get("message", ""))
            )
        flash_bytes = (resp.get("result") or {}).get("flashBytes")
        circuit_result: dict[str, Any] | None = None
        if circuit is not None:
            cmd = {
                "cmd": "attach_circuit",
                "board": circuit.get("board"),
                "netlist": circuit.get("netlist"),
                "components": circuit.get("components"),
            }
            resp, circuit_events = await self._worker_call(cmd)
            events.extend(circuit_events)
            if not resp.get("ok"):
                err = resp.get("error") or {}
                await self.terminate("failed", str(err.get("code")), notify=False)
                raise CommandError(
                    str(err.get("code", "INVALID_ARGUMENT")), str(err.get("message", ""))
                )
            circuit_result = resp.get("result")

        logger.info(
            "simulation started",
            extra={
                "fields": {
                    "simulationId": self.simulation_id,
                    "projectId": self.project_id,
                    "startTime": self.start_time,
                    "speed": self.speed,
                }
            },
        )
        started = _event(
            "simulation_started", self.cycle, {"speed": self.speed, "sliceMs": SLICE_MS}
        )
        await self.send_batch([started, *events], force=True)
        self._start_pacer()
        return {
            "simulationId": self.simulation_id,
            "cycle": self.cycle,
            "flashBytes": flash_bytes,
            "circuit": circuit_result,
            "sliceMs": SLICE_MS,
            "speed": self.speed,
        }

    async def cmd_pause(self, _msg: dict[str, Any]) -> dict[str, Any]:
        self._require_worker()
        if self.state != "running":
            raise CommandError("NOT_RUNNING", "simulation is not running")
        await self._stop_pacer(cancel=False)
        self.state = "paused"
        await self.send_batch(
            [_event("simulation_paused", self.cycle, {"reason": "client"})], force=True
        )
        return {"cycle": self.cycle}

    async def cmd_resume(self, _msg: dict[str, Any]) -> dict[str, Any]:
        self._require_worker()
        if self.state != "paused":
            raise CommandError("NOT_PAUSED", "simulation is not paused")
        await self.send_batch([_event("simulation_resumed", self.cycle, {})], force=True)
        self._start_pacer()
        return {"cycle": self.cycle}

    async def cmd_stop(self, _msg: dict[str, Any]) -> dict[str, Any]:
        self._require_worker()
        await self._stop_pacer(cancel=False)
        cycle = self.cycle
        await self.terminate("stopped", None, reason="client")
        return {"cycle": cycle}

    async def cmd_reset(self, _msg: dict[str, Any]) -> dict[str, Any]:
        resp, events = await self._worker_call({"cmd": "reset"})
        await self.send_batch(events, force=True)
        return self._worker_result(resp)

    async def cmd_component_input(self, msg: dict[str, Any]) -> dict[str, Any]:
        cmd = {
            "cmd": "set_component_input",
            "componentId": msg.get("componentId"),
            "input": msg.get("input"),
        }
        resp, events = await self._worker_call(cmd)
        await self.send_batch(events)
        return self._worker_result(resp)

    async def cmd_serial_input(self, msg: dict[str, Any]) -> dict[str, Any]:
        cmd: dict[str, Any] = {"cmd": "serial_input"}
        if "bytes" in msg:
            cmd["bytes"] = msg["bytes"]
        else:
            cmd["data"] = msg.get("data")
        resp, events = await self._worker_call(cmd)
        await self.send_batch(events)
        return self._worker_result(resp)

    def _worker_result(self, resp: dict[str, Any]) -> dict[str, Any]:
        if not resp.get("ok"):
            err = resp.get("error") or {}
            raise CommandError(str(err.get("code", "WORKER_ERROR")), str(err.get("message", "")))
        return resp.get("result") or {}

    # --- темп симуляции ---

    def _start_pacer(self) -> None:
        self.generation += 1
        self.state = "running"
        self.base_wall = time.monotonic()
        self.base_cycle = self.cycle
        self.pacer = asyncio.create_task(self._pace(self.generation))

    async def _stop_pacer(self, cancel: bool) -> None:
        """Останавливает выдачу срезов; без cancel текущий срез завершается и его события отправляются."""
        self.generation += 1
        task, self.pacer = self.pacer, None
        if task is None or task is asyncio.current_task():
            return
        if cancel:
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task

    async def _pace(self, generation: int) -> None:
        worker = self.worker
        assert worker is not None
        try:
            while self.generation == generation and self.state == "running":
                sink = EventSink(self)
                # Границы срезов — кратные SLICE_CYCLES от включения питания: перебег последней
                # инструкции среза не накапливается, и точки применения воздействий воспроизводимы.
                cycles = (self.cycle // SLICE_CYCLES + 1) * SLICE_CYCLES - self.cycle
                resp = await worker.call({"cmd": "run_for", "cycles": cycles}, sink)
                result = resp.get("result") or {}
                if isinstance(result.get("cycle"), int):
                    self.cycle = result["cycle"]
                events = sink.finish()
                if not resp.get("ok"):
                    err = resp.get("error") or {}
                    code = str(err.get("code"))
                    if code != "CIRCUIT_FAULT":
                        raise WorkerFailure(code, str(err.get("message", "")))
                    await self._auto_pause(events, "circuit_fault", generation)
                    return
                if result.get("halted"):
                    await self._auto_pause(events, "cpu_halted", generation)
                    return
                await self.send_batch(events)
                deadline = self.base_wall + (self.cycle - self.base_cycle) / (CLOCK_HZ * self.speed)
                delay = deadline - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                elif -delay > MAX_LAG_SECONDS:
                    # Симуляция не успевает: отсчёт темпа начинается заново, время не «догоняется».
                    self.base_wall = time.monotonic()
                    self.base_cycle = self.cycle
                    if not self.warned_lag:
                        self.warned_lag = True
                        await self.send_batch(
                            [
                                _event(
                                    "simulation_error",
                                    self.cycle,
                                    {
                                        "code": "SIMULATION_SLOWER_THAN_REALTIME",
                                        "severity": "warning",
                                        "message": "simulation cannot keep up with the requested speed",
                                    },
                                )
                            ],
                            force=True,
                        )
        except WorkerFailure as e:
            if self.generation == generation:
                await self.fail(e)

    async def _auto_pause(self, events: list[dict[str, Any]], reason: str, generation: int) -> None:
        if self.generation != generation:
            await self.send_batch(events, force=True)
            return
        self.generation += 1
        self.pacer = None
        self.state = "paused"
        events.append(_event("simulation_paused", self.cycle, {"reason": reason}))
        await self.send_batch(events, force=True)

    # --- завершение ---

    async def fail(self, e: WorkerFailure) -> None:
        if self.worker is None:
            return
        logger.warning(
            "worker failure",
            extra={"fields": {"simulationId": self.simulation_id, "errorCode": e.code}},
        )
        await self.send_batch(
            [
                _event(
                    "simulation_error",
                    self.cycle,
                    {"code": e.code, "severity": "error", "message": e.message},
                )
            ],
            force=True,
        )
        await self.terminate("failed", e.code, reason="worker_failed")

    async def shutdown(self, status: str, reason: str | None) -> None:
        """Остановка извне (таймаут, простой, отключение): текущий срез прерывается."""
        async with self.cmd_lock:
            await self._stop_pacer(cancel=True)
            await self.terminate(status, None, reason=reason)

    async def terminate(
        self, status: str, error_code: str | None, reason: str | None = None, notify: bool = True
    ) -> None:
        global _active_sessions
        worker, self.worker = self.worker, None
        if worker is None:
            return
        self.generation += 1
        if self.pacer is not None and self.pacer is not asyncio.current_task():
            self.pacer.cancel()
        self.pacer = None
        self.state = "stopped"
        exit_code = await worker.close()
        _active_sessions -= 1
        logger.info(
            "simulation ended",
            extra={
                "fields": {
                    "simulationId": self.simulation_id,
                    "projectId": self.project_id,
                    "startTime": self.start_time,
                    "endTime": _now_iso(),
                    "status": status,
                    "errorCode": error_code,
                    "reason": reason,
                    "cycle": self.cycle,
                    "workerExit": exit_code,
                }
            },
        )
        if notify and reason is not None:
            await self.send_batch(
                [_event("simulation_stopped", self.cycle, {"reason": reason})], force=True
            )

    async def watchdog(self) -> None:
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            if self.worker is not None and now - self.started_wall > MAX_SESSION_SECONDS:
                await self.shutdown("timeout", "session_timeout")
                await self.ws.close(1000, "session timeout")
                return
            if self.state != "running" and now - self.last_client_msg > IDLE_TIMEOUT_SECONDS:
                await self.shutdown("idle", "idle_timeout")
                await self.ws.close(1000, "idle timeout")
                return


# --- сервер ---


def _health() -> dict[str, Any]:
    return {"status": "ok", "activeSessions": _active_sessions, "maxSessions": MAX_SESSIONS}


def process_request(connection: ServerConnection, request: Request) -> Response | None:
    if request.path == "/healthz":
        response = connection.respond(HTTPStatus.OK, json.dumps(_health()) + "\n")
        response.headers["Content-Type"] = "application/json"
        return response
    if request.path != "/sessions":
        return connection.respond(HTTPStatus.NOT_FOUND, "Not found.\n")
    return None


async def handler(ws: ServerConnection) -> None:
    global _connections
    if _connections >= MAX_CONNECTIONS:
        await ws.send(
            json.dumps(
                {
                    "version": PROTOCOL_VERSION,
                    "type": "response",
                    "id": None,
                    "ok": False,
                    "error": {"code": "SIMULATOR_BUSY", "message": "too many connections"},
                }
            )
        )
        await ws.close(1013, "busy")
        return
    _connections += 1
    session = Session(ws)
    watchdog = asyncio.create_task(session.watchdog())
    try:
        async for raw in ws:
            await session.handle(raw)
    except ConnectionClosed:
        pass
    finally:
        watchdog.cancel()
        # Отключение клиента: worker уничтожается немедленно.
        await session.shutdown("disconnected", None)
        _connections -= 1


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        entry.update(getattr(record, "fields", {}))
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


async def serve_forever(host: str = "0.0.0.0", port: int = PORT) -> None:  # noqa: S104 — внутренняя сеть
    stop = asyncio.get_running_loop().create_future()
    with contextlib.suppress(NotImplementedError):
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set_result, None)
    async with serve(
        handler,
        host,
        port,
        process_request=process_request,
        max_size=MAX_MESSAGE_BYTES,
        max_queue=16,
        compression=None,
        ping_interval=20,
        ping_timeout=20,
        server_header=None,
    ):
        logger.info("listening", extra={"fields": {"port": port, "maxSessions": MAX_SESSIONS}})
        await stop


def main() -> None:
    handler_ = logging.StreamHandler(sys.stdout)
    handler_.setFormatter(JsonFormatter())
    logging.basicConfig(level=os.environ.get("SIM_LOG_LEVEL", "INFO"), handlers=[handler_])
    # Журнал websockets не должен содержать тела сообщений (прошивка, схема).
    logging.getLogger("websockets").setLevel(logging.WARNING)
    asyncio.run(serve_forever())


if __name__ == "__main__":
    main()
