"""Сессии симуляции проектов.

API не эмулирует микроконтроллер: прошивка выполняется в изолированном сервисе симуляции
(services/simulator), к которому API подключается по WebSocket
(``{MICROLAB_SIMULATOR_URL}/sessions``, одно подключение — одна сессия). Здесь только оркестрация:

* реестр сессий в памяти процесса: не больше одной активной сессии на проект, новый запуск
  останавливает предыдущий;
* команды (``start``, ``pause``, ``resume``, ``stop``, ``reset``, ``set_component_input``,
  ``serial_input``) с таймаутами и преобразованием ошибок сервиса в стабильные коды API;
* ретрансляция пачек событий ``event_batch`` (протокол версии 1) подписчикам WebSocket
  проекта без изменений; последнее состояние выводов и компонентов запоминается, чтобы
  новый подписчик (вторая вкладка, переподключение) сразу получил текущую картину;
* сессия без подписчиков останавливается по таймауту простоя.

Сообщения API подписчику, кроме пересланных ``event_batch``:

* ``{"version": 1, "type": "session_state", "session": {…} | null, "events": […],
  "serialTail": […]}`` — при подписке и в начале каждой новой сессии. Все пачки после
  него относятся к этой сессии.
  ``events`` — последние события состояния (выводы, PWM, компоненты, АЦП), ``serialTail`` —
  последние байты вывода Serial (не больше :data:`SERIAL_TAIL_BYTES`).
* при потере связи с сервисом симуляции — ``event_batch`` с событиями ``simulation_error``
  (``SIMULATOR_UNAVAILABLE``) и ``simulation_stopped`` (``reason: "simulator_disconnected"``).
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Final

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake, InvalidURI

from microlab_api.config import Settings
from microlab_api.logging import request_id_var
from microlab_api.schemas.errors import ErrorCode
from microlab_api.schemas.simulation import SimulationInfo, SimulationStatus

logger = logging.getLogger(__name__)

PROTOCOL_VERSION: Final = 1
CYCLES_PER_US: Final = 16
# Хвост вывода Serial, который получает новый подписчик.
SERIAL_TAIL_BYTES: Final = 4096
# Очередь сообщений одного подписчика; переполненная очередь отключает подписчика
# (клиент переподключается и получает текущее состояние).
SUBSCRIBER_QUEUE_SIZE: Final = 512
# Самое большое сообщение сервиса симуляции — пачка событий одного среза.
MAX_SUPERVISOR_MESSAGE_BYTES: Final = 4 * 1024 * 1024

# События, последнее значение которых образует текущее состояние (ключ — вывод или компонент).
_STATE_EVENTS: Final = {
    "digital_pin_changed": "pin",
    "pwm_changed": "pin",
    "analog_value_changed": "pin",
    "component_state_changed": "componentId",
}


class SimulationError(Exception):
    """Команду симуляции выполнить не удалось; ``code`` — стабильный код API."""

    def __init__(
        self, status_code: int, code: ErrorCode, message: str, detail_code: str | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail_code = detail_code


def _unavailable(message: str = "Simulator is unavailable.") -> SimulationError:
    return SimulationError(503, ErrorCode.SIMULATOR_UNAVAILABLE, message)


def _not_running() -> SimulationError:
    return SimulationError(409, ErrorCode.SIMULATION_NOT_RUNNING, "Simulation is not running.")


# Коды ошибок сервиса симуляции → ошибки API.
_STATE_ERRORS: Final = frozenset({"NOT_STARTED", "NOT_RUNNING", "NOT_PAUSED"})
_INPUT_ERRORS: Final = frozenset(
    {"UNKNOWN_COMPONENT", "UNSUPPORTED_INPUT", "INVALID_ARGUMENT", "NO_CIRCUIT", "UNKNOWN_PIN"}
)


def map_supervisor_error(code: str, message: str, *, starting: bool) -> SimulationError:
    if code == "SIMULATOR_BUSY":
        return SimulationError(
            503, ErrorCode.SIMULATOR_BUSY, "All simulation slots are in use, try again later."
        )
    if code.startswith("WORKER_"):
        return SimulationError(
            503, ErrorCode.SIMULATOR_UNAVAILABLE, "Simulation worker failed.", code
        )
    if starting:
        return SimulationError(
            502, ErrorCode.SIMULATION_START_FAILED, f"Simulation could not start: {message}", code
        )
    if code in _STATE_ERRORS:
        return SimulationError(
            409,
            ErrorCode.SIMULATION_NOT_RUNNING,
            "Simulation is not in a state for this command.",
            code,
        )
    if code in _INPUT_ERRORS:
        return SimulationError(
            422,
            ErrorCode.INVALID_SIMULATION_INPUT,
            f"Simulator rejected the input: {message}",
            code,
        )
    return SimulationError(502, ErrorCode.SIMULATOR_UNAVAILABLE, "Simulator error.", code)


class SupervisorCommandError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class SupervisorLink:
    """WebSocket-подключение к сервису симуляции: команды с ответами и поток сообщений."""

    def __init__(
        self,
        ws: ClientConnection,
        on_message: Callable[[str, dict[str, Any]], None],
        on_closed: Callable[[], None],
        command_timeout: float,
    ) -> None:
        self._ws = ws
        self._on_message = on_message
        self._on_closed = on_closed
        self._command_timeout = command_timeout
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._reader = asyncio.create_task(self._read())

    @classmethod
    async def open(
        cls,
        url: str,
        *,
        connect_timeout: float,
        command_timeout: float,
        on_message: Callable[[str, dict[str, Any]], None],
        on_closed: Callable[[], None],
    ) -> SupervisorLink:
        try:
            ws = await connect(
                url.rstrip("/") + "/sessions",
                open_timeout=connect_timeout,
                close_timeout=5,
                max_size=MAX_SUPERVISOR_MESSAGE_BYTES,
                compression=None,
                ping_interval=20,
                ping_timeout=20,
                # Сервис во внутренней сети: прокси окружения не используются.
                proxy=None,
            )
        except (OSError, TimeoutError, InvalidHandshake, InvalidURI) as exc:
            logger.warning("simulator connection failed", extra={"error_type": type(exc).__name__})
            raise _unavailable() from None
        return cls(ws, on_message, on_closed, command_timeout)

    async def _read(self) -> None:
        # Задача живёт дольше запроса, который её создал: записи журнала не относятся к нему.
        request_id_var.set(None)
        try:
            async for raw in self._ws:
                if not isinstance(raw, str):
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(msg, dict) or msg.get("version") != PROTOCOL_VERSION:
                    continue
                if msg.get("type") == "response":
                    msg_id = msg.get("id")
                    future = self._pending.pop(msg_id, None) if isinstance(msg_id, int) else None
                    if future is not None and not future.done():
                        future.set_result(msg)
                    continue
                self._on_message(raw, msg)
        except ConnectionClosed:
            pass
        finally:
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(_unavailable("Simulator connection was lost."))
            self._pending.clear()
            self._on_closed()

    async def call(self, command: str, **params: Any) -> dict[str, Any]:
        """Отправляет команду и ждёт ответ; ``SupervisorCommandError`` — ответ с ошибкой."""
        msg_id = next(self._ids)
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = future
        try:
            await self._ws.send(
                json.dumps({"type": command, "id": msg_id, **params}, separators=(",", ":"))
            )
            response = await asyncio.wait_for(future, self._command_timeout)
        except ConnectionClosed:
            raise _unavailable("Simulator connection was lost.") from None
        except TimeoutError:
            logger.warning("simulator command timed out", extra={"command": command})
            await self.close()
            raise _unavailable("Simulator did not respond.") from None
        finally:
            self._pending.pop(msg_id, None)
        if not response.get("ok"):
            error = response.get("error") or {}
            raise SupervisorCommandError(
                str(error.get("code", "UNKNOWN")), str(error.get("message", ""))
            )
        result = response.get("result")
        return result if isinstance(result, dict) else {}

    async def close(self) -> None:
        with contextlib.suppress(Exception):
            await self._ws.close()
        if self._reader is not asyncio.current_task():
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._reader


class Subscriber:
    """Подписчик WebSocket проекта: очередь готовых к отправке сообщений."""

    def __init__(self, project_id: uuid.UUID) -> None:
        self.project_id = project_id
        # None в очереди — сигнал закрыть подключение.
        self.queue: asyncio.Queue[str | None] = asyncio.Queue(SUBSCRIBER_QUEUE_SIZE + 1)
        self.closed = False

    def push(self, text: str) -> None:
        if self.closed:
            return
        if self.queue.qsize() >= SUBSCRIBER_QUEUE_SIZE:
            # Клиент не успевает читать: отключаем, после переподключения он получит состояние.
            self.closed = True
            self.queue.put_nowait(None)
            return
        self.queue.put_nowait(text)


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class SimulationSession:
    project_id: uuid.UUID
    simulation_id: str
    publish: Callable[[str], None]
    owner_id: uuid.UUID | None = None
    status: SimulationStatus = "starting"
    start_time: datetime = field(default_factory=_now)
    end_time: datetime | None = None
    error_code: str | None = None
    cycle: int = 0
    link: SupervisorLink | None = None
    latest: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    serial_tail: bytearray = field(default_factory=bytearray)
    _close_task: asyncio.Task[None] | None = None

    @property
    def active(self) -> bool:
        return self.status in ("starting", "running", "paused")

    def info(self) -> SimulationInfo:
        return SimulationInfo(
            simulation_id=self.simulation_id,
            project_id=self.project_id,
            status=self.status,
            start_time=self.start_time,
            end_time=self.end_time,
            error_code=self.error_code,
            timestamp=self.cycle // CYCLES_PER_US,
            cycle=self.cycle,
        )

    def state_message(self) -> str:
        return session_state_message(self)

    # --- сообщения сервиса симуляции ---

    def handle_message(self, raw: str, msg: dict[str, Any]) -> None:
        if msg.get("type") != "event_batch":
            return
        cycle = msg.get("cycle")
        if isinstance(cycle, int):
            self.cycle = max(self.cycle, cycle)
        events = msg.get("events")
        stopped_reason: str | None = None
        for event in events if isinstance(events, list) else []:
            if isinstance(event, dict):
                stopped_reason = self._apply(event) or stopped_reason
        self.publish(raw)
        if stopped_reason is not None:
            self.finish("failed" if self.error_code is not None else "stopped", stopped_reason)

    def _apply(self, event: dict[str, Any]) -> str | None:
        kind = event.get("type")
        raw_payload = event.get("payload")
        payload: dict[str, Any] = raw_payload if isinstance(raw_payload, dict) else {}
        if kind in ("simulation_started", "simulation_resumed"):
            self.status = "running"
        elif kind == "simulation_paused":
            self.status = "paused"
        elif kind == "simulation_stopped":
            return str(payload.get("reason") or "stopped")
        elif kind == "simulation_reset":
            self.latest.clear()
        elif kind == "simulation_error":
            # Ошибка без адреса команды — сбой worker, после него сессия завершается.
            if payload.get("severity") == "error" and "pc" not in payload:
                self.error_code = str(payload.get("code"))
        elif kind == "serial_output":
            data = payload.get("bytes")
            if isinstance(data, list):
                self.serial_tail.extend(b for b in data if isinstance(b, int) and 0 <= b <= 255)
                del self.serial_tail[:-SERIAL_TAIL_BYTES]
        elif isinstance(kind, str) and kind in _STATE_EVENTS:
            key = payload.get(_STATE_EVENTS[kind])
            if isinstance(key, str):
                self.latest.pop((kind, key), None)
                self.latest[(kind, key)] = event
        return None

    def handle_link_closed(self) -> None:
        if not self.active:
            return
        self.error_code = ErrorCode.SIMULATOR_UNAVAILABLE.value
        timestamp = self.cycle // CYCLES_PER_US
        self.publish(
            json.dumps(
                {
                    "version": PROTOCOL_VERSION,
                    "type": "event_batch",
                    "timestamp": timestamp,
                    "cycle": self.cycle,
                    "events": [
                        {
                            "version": PROTOCOL_VERSION,
                            "type": "simulation_error",
                            "timestamp": timestamp,
                            "cycle": self.cycle,
                            "payload": {
                                "code": ErrorCode.SIMULATOR_UNAVAILABLE.value,
                                "severity": "error",
                                "message": "connection to the simulator was lost",
                            },
                        },
                        {
                            "version": PROTOCOL_VERSION,
                            "type": "simulation_stopped",
                            "timestamp": timestamp,
                            "cycle": self.cycle,
                            "payload": {"reason": "simulator_disconnected"},
                        },
                    ],
                },
                separators=(",", ":"),
            )
        )
        self.finish("failed", "simulator_disconnected")

    def finish(self, status: SimulationStatus, reason: str) -> None:
        if not self.active:
            return
        self.status = status
        self.end_time = _now()
        logger.info(
            "simulation session ended",
            extra={
                "simulationId": self.simulation_id,
                "projectId": str(self.project_id),
                "startTime": self.start_time.isoformat(),
                "endTime": self.end_time.isoformat(),
                "status": status,
                "errorCode": self.error_code,
                "reason": reason,
            },
        )
        link = self.link
        if link is not None and self._close_task is None:
            self._close_task = asyncio.get_running_loop().create_task(link.close())


def session_state_message(session: SimulationSession | None) -> str:
    body: dict[str, Any] = {
        "version": PROTOCOL_VERSION,
        "type": "session_state",
        "session": None,
        "events": [],
        "serialTail": [],
    }
    if session is not None:
        body["session"] = session.info().model_dump(mode="json")
        body["events"] = list(session.latest.values())
        body["serialTail"] = list(session.serial_tail)
    return json.dumps(body, separators=(",", ":"))


class SimulationManager:
    """Реестр сессий симуляции процесса API (по одной на проект)."""

    def __init__(self, settings: Settings) -> None:
        self._url = str(settings.simulator_url) if settings.simulator_url is not None else None
        self._connect_timeout = settings.simulator_connect_timeout_seconds
        self._command_timeout = settings.simulator_command_timeout_seconds
        self._idle_timeout = settings.simulation_idle_timeout_seconds
        self._max_per_user = settings.max_simulations_per_user
        self._sessions: dict[uuid.UUID, SimulationSession] = {}
        self._subscribers: dict[uuid.UUID, set[Subscriber]] = {}
        self._locks: dict[uuid.UUID, asyncio.Lock] = {}
        self._idle: dict[uuid.UUID, asyncio.Task[None]] = {}

    # --- подписчики ---

    def publish(self, project_id: uuid.UUID, text: str) -> None:
        for subscriber in list(self._subscribers.get(project_id, ())):
            subscriber.push(text)

    def subscribe(self, project_id: uuid.UUID) -> Subscriber:
        subscriber = Subscriber(project_id)
        self._subscribers.setdefault(project_id, set()).add(subscriber)
        idle = self._idle.pop(project_id, None)
        if idle is not None:
            idle.cancel()
        subscriber.push(session_state_message(self.current(project_id)))
        return subscriber

    def unsubscribe(self, subscriber: Subscriber) -> None:
        subscribers = self._subscribers.get(subscriber.project_id)
        if subscribers is None:
            return
        subscribers.discard(subscriber)
        if not subscribers:
            del self._subscribers[subscriber.project_id]
            self._schedule_idle_stop(subscriber.project_id)

    def _schedule_idle_stop(self, project_id: uuid.UUID) -> None:
        session = self._sessions.get(project_id)
        if session is None or not session.active or self._subscribers.get(project_id):
            return
        previous = self._idle.pop(project_id, None)
        if previous is not None:
            previous.cancel()
        self._idle[project_id] = asyncio.get_running_loop().create_task(self._idle_stop(project_id))

    async def _idle_stop(self, project_id: uuid.UUID) -> None:
        request_id_var.set(None)
        await asyncio.sleep(self._idle_timeout)
        self._idle.pop(project_id, None)
        logger.info("simulation idle timeout", extra={"projectId": str(project_id)})
        with contextlib.suppress(SimulationError):
            await self.stop(project_id)

    # --- сессии ---

    def current(self, project_id: uuid.UUID) -> SimulationSession | None:
        """Активная или последняя сессия проекта."""
        return self._sessions.get(project_id)

    def _lock(self, project_id: uuid.UUID) -> asyncio.Lock:
        return self._locks.setdefault(project_id, asyncio.Lock())

    async def _enforce_user_quota(self, project_id: uuid.UUID, owner_id: uuid.UUID) -> None:
        """Квота одновременных симуляций пользователя: старейшие сессии других проектов
        пользователя останавливаются (reason "quota"), чтобы запуск нового проекта не
        упирался в забытую вкладку."""
        others = sorted(
            (
                s
                for s in self._sessions.values()
                if s.active and s.owner_id == owner_id and s.project_id != project_id
            ),
            key=lambda s: s.start_time,
        )
        while len(others) >= self._max_per_user:
            oldest = others.pop(0)
            async with self._lock(oldest.project_id):
                if oldest.active:
                    await self._stop_session(oldest, reason="quota")

    async def start(
        self,
        project_id: uuid.UUID,
        firmware_hex: str,
        circuit: dict[str, Any],
        *,
        owner_id: uuid.UUID | None = None,
    ) -> SimulationSession:
        if self._url is None:
            raise _unavailable("Simulator is not configured.")
        if owner_id is not None:
            await self._enforce_user_quota(project_id, owner_id)
        async with self._lock(project_id):
            previous = self._sessions.get(project_id)
            if previous is not None and previous.active:
                await self._stop_session(previous, reason="replaced")

            session = SimulationSession(
                project_id=project_id,
                simulation_id=str(uuid.uuid4()),
                publish=lambda text: self.publish(project_id, text),
                owner_id=owner_id,
            )
            self._sessions[project_id] = session
            self.publish(project_id, session.state_message())
            try:
                session.link = await SupervisorLink.open(
                    self._url,
                    connect_timeout=self._connect_timeout,
                    command_timeout=self._command_timeout,
                    on_message=session.handle_message,
                    on_closed=session.handle_link_closed,
                )
            except SimulationError as exc:
                session.error_code = exc.code.value
                session.finish("failed", "connect_failed")
                raise
            try:
                result = await session.link.call(
                    "start",
                    firmwareHex=firmware_hex,
                    circuit=circuit,
                    simulationId=session.simulation_id,
                    projectId=str(project_id),
                )
            except SupervisorCommandError as exc:
                session.error_code = exc.code
                session.finish("failed", "start_failed")
                raise map_supervisor_error(exc.code, exc.message, starting=True) from None
            except SimulationError as exc:
                session.error_code = exc.code.value
                session.finish("failed", "start_failed")
                raise
            if session.status == "starting":
                session.status = "running"
            logger.info(
                "simulation session started",
                extra={
                    "simulationId": session.simulation_id,
                    "projectId": str(project_id),
                    "startTime": session.start_time.isoformat(),
                    "flashBytes": result.get("flashBytes"),
                },
            )
            self._schedule_idle_stop(project_id)
            return session

    def _active(self, project_id: uuid.UUID) -> SimulationSession:
        session = self._sessions.get(project_id)
        if session is None or not session.active or session.link is None:
            raise _not_running()
        return session

    async def command(
        self, project_id: uuid.UUID, command: str, **params: Any
    ) -> tuple[SimulationSession, dict[str, Any]]:
        """Команда активной сессии (pause, resume, reset, set_component_input, serial_input)."""
        session = self._active(project_id)
        link = session.link
        if link is None:
            raise _not_running()
        try:
            result = await link.call(command, **params)
        except SupervisorCommandError as exc:
            raise map_supervisor_error(exc.code, exc.message, starting=False) from None
        return session, result

    async def stop(self, project_id: uuid.UUID) -> tuple[SimulationSession, dict[str, Any]]:
        async with self._lock(project_id):
            session = self._active(project_id)
            result = await self._stop_session(session, reason="client")
            return session, result

    async def _stop_session(self, session: SimulationSession, reason: str) -> dict[str, Any]:
        link = session.link
        result: dict[str, Any] = {}
        if link is not None:
            with contextlib.suppress(SupervisorCommandError, SimulationError):
                result = await link.call("stop")
        session.finish("stopped", reason)
        if link is not None:
            await link.close()
        return result

    async def aclose(self) -> None:
        for task in self._idle.values():
            task.cancel()
        self._idle.clear()
        for session in list(self._sessions.values()):
            if session.active:
                with contextlib.suppress(Exception):
                    await self._stop_session(session, reason="shutdown")
        for subscribers in self._subscribers.values():
            for subscriber in subscribers:
                subscriber.closed = True
                with contextlib.suppress(asyncio.QueueFull):
                    subscriber.queue.put_nowait(None)
