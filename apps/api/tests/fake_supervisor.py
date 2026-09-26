"""Поддельный сервис симуляции для тестов: WebSocket-сервер в отдельном потоке.

Отвечает на команды протокола версии 1 так же, как настоящий сервис (пачка событий перед
ответом), но без worker. Отдельный поток со своим event loop нужен, чтобы сервер работал
независимо от event loop тестового клиента.
"""

import asyncio
import json
import threading
from typing import Any

from websockets.asyncio.server import Server, ServerConnection, serve


def event(kind: str, cycle: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": 1,
        "type": kind,
        "timestamp": cycle // 16,
        "cycle": cycle,
        "payload": payload,
    }


def batch(cycle: int, events: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "version": 1,
        "type": "event_batch",
        "timestamp": cycle // 16,
        "cycle": cycle,
        "events": events,
    }


LED_ON = event(
    "component_state_changed",
    160_000,
    {"componentId": "led1", "state": {"on": True, "currentMa": 11.5, "brightness": 0.57}},
)
D13_HIGH = event("digital_pin_changed", 160_000, {"pin": "D13", "mode": "output-high", "value": 1})
SERIAL = event("serial_output", 160_000, {"port": "Serial", "bytes": [104, 105, 10]})


class FakeSupervisor:
    def __init__(self) -> None:
        self.received: list[dict[str, Any]] = []
        # Код ошибки, которым отвечает следующая команда start.
        self.start_error: str | None = None
        self.connections: list[ServerConnection] = []
        self._loop = asyncio.new_event_loop()
        self._server: Server | None = None
        self._thread = threading.Thread(target=self._loop.run_forever, daemon=True)
        self.url = ""

    def __enter__(self) -> "FakeSupervisor":
        self._thread.start()
        future = asyncio.run_coroutine_threadsafe(self._serve(), self._loop)
        future.result(5)
        return self

    def __exit__(self, *_exc: object) -> None:
        asyncio.run_coroutine_threadsafe(self._shutdown(), self._loop).result(5)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(5)
        self._loop.close()

    async def _serve(self) -> None:
        self._server = await serve(self._handler, "127.0.0.1", 0)
        port = next(iter(self._server.sockets)).getsockname()[1]
        self.url = f"ws://127.0.0.1:{port}"

    async def _shutdown(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    def commands(self) -> list[str]:
        return [str(msg.get("type")) for msg in self.received]

    def drop_connections(self) -> None:
        """Обрывает подключения (сервис симуляции перезапущен)."""

        async def drop() -> None:
            for ws in self.connections:
                ws.transport.abort()

        asyncio.run_coroutine_threadsafe(drop(), self._loop).result(5)

    def _respond(self, msg: dict[str, Any], cycle: int) -> tuple[list[dict[str, Any]], Any]:
        """События и результат (или код ошибки строкой) команды, кроме start."""
        kind = msg.get("type")
        lifecycle = {
            "pause": ("simulation_paused", {"reason": "client"}),
            "resume": ("simulation_resumed", {}),
            "reset": ("simulation_reset", {}),
            "stop": ("simulation_stopped", {"reason": "client"}),
        }
        if kind in lifecycle:
            name, payload = lifecycle[str(kind)]
            return [event(name, cycle, payload)], {"cycle": cycle}
        if kind == "set_component_input":
            if msg.get("componentId") != "button1":
                return [], "UNKNOWN_COMPONENT"
            return [], {"changed": True, "cycle": 320_000}
        if kind == "serial_input":
            return [], {"accepted": len(str(msg.get("data")).encode()), "cycle": 320_000}
        return [], "UNKNOWN_COMMAND"

    async def _handler(self, ws: ServerConnection) -> None:
        self.connections.append(ws)
        cycle = 0
        async for raw in ws:
            msg = json.loads(raw)
            self.received.append(msg)
            outcome: Any
            if msg.get("type") != "start":
                events, outcome = self._respond(msg, cycle)
            elif self.start_error is not None:
                events, outcome, self.start_error = [], self.start_error, None
            else:
                started = [event("simulation_started", 0, {"speed": 1.0, "sliceMs": 10})]
                await ws.send(json.dumps(batch(0, started)))
                cycle = 160_000
                events = [D13_HIGH, LED_ON, SERIAL]
                outcome = {"simulationId": msg.get("simulationId"), "cycle": 0}
            if events:
                await ws.send(json.dumps(batch(cycle, events)))
            response: dict[str, Any] = {"version": 1, "type": "response", "id": msg.get("id")}
            if isinstance(outcome, str):
                response |= {"ok": False, "error": {"code": outcome, "message": "fake error"}}
            else:
                response |= {"ok": True, "result": outcome}
            await ws.send(json.dumps(response))
