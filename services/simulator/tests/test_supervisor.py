"""Интеграционные тесты супервизора симуляции (unittest + клиент websockets).

Режимы:

* по умолчанию супервизор запускается в процессе теста с локально собранным worker
  (``simulation/target/release/microlab-sim-worker``, путь можно задать ``SIM_WORKER``);
* ``SIM_TEST_URL=ws://127.0.0.1:8082`` — тесты идут к уже запущенному сервису (контейнер).

Запуск: ``uv run --with websockets==17.1 python -m unittest discover -s services/simulator/tests -v``.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import time
import unittest
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "simulation" / "tests" / "fixtures"
EXTERNAL_URL = os.environ.get("SIM_TEST_URL")

if not EXTERNAL_URL:
    os.environ.setdefault(
        "SIM_WORKER", str(ROOT / "simulation" / "target" / "release" / "microlab-sim-worker")
    )
    if not shutil.which("prlimit"):
        os.environ.setdefault("SIM_PRLIMIT", "")
    else:
        os.environ.setdefault("SIM_PRLIMIT", shutil.which("prlimit") or "")
    os.environ.setdefault("SIM_MAX_SESSIONS", "3")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import supervisor  # noqa: E402

from websockets.asyncio.client import ClientConnection, connect  # noqa: E402

BLINK_HEX = (FIXTURES / "blink" / "blink.hex").read_text()
BUTTON_HEX = (FIXTURES / "button_pullup" / "button_pullup.hex").read_text()

LED_CIRCUIT = {
    "board": {"id": "uno1", "type": "arduino-uno-r3"},
    "components": [
        {"id": "uno1", "type": "arduino-uno-r3", "properties": {}},
        {"id": "r1", "type": "resistor", "properties": {"resistanceOhms": 220}},
        {"id": "led1", "type": "led", "properties": {}},
    ],
    "netlist": [
        {"id": "n1", "members": ["uno1.D13", "r1.1"]},
        {"id": "n2", "members": ["r1.2", "led1.A"]},
        {"id": "n3", "members": ["led1.K", "uno1.GND1"]},
    ],
}

BUTTON_CIRCUIT = {
    "board": {"id": "uno1", "type": "arduino-uno-r3"},
    "components": [
        {"id": "uno1", "type": "arduino-uno-r3", "properties": {}},
        {"id": "sw1", "type": "push-button", "properties": {}},
    ],
    "netlist": [
        {"id": "n1", "members": ["uno1.D2", "sw1.A"]},
        {"id": "n2", "members": ["sw1.B", "uno1.GND1"]},
    ],
}


class Client:
    """Клиент сессии: собирает события и ответы по id."""

    def __init__(self, ws: ClientConnection) -> None:
        self.ws = ws
        self.events: list[tuple[float, dict[str, Any]]] = []
        self.batches: list[tuple[float, dict[str, Any]]] = []
        self.responses: dict[Any, dict[str, Any]] = {}
        self._waiters: dict[Any, asyncio.Future[dict[str, Any]]] = {}
        self._next = 0
        self._reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        async for raw in self.ws:
            msg = json.loads(raw)
            assert msg["version"] == 1, msg
            now = time.monotonic()
            if msg["type"] == "event_batch":
                self.batches.append((now, msg))
                self.events.extend((now, e) for e in msg["events"])
            elif msg["type"] == "response":
                fut = self._waiters.pop(msg["id"], None)
                if fut is not None:
                    fut.set_result(msg)
                self.responses[msg["id"]] = msg

    async def call(self, kind: str, **fields: Any) -> dict[str, Any]:
        self._next += 1
        msg_id = self._next
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._waiters[msg_id] = fut
        await self.ws.send(json.dumps({"type": kind, "id": msg_id, **fields}))
        return await asyncio.wait_for(fut, 15)

    def of_type(self, kind: str) -> list[dict[str, Any]]:
        return [e for _, e in self.events if e["type"] == kind]

    async def close(self) -> None:
        await self.ws.close()
        self._reader.cancel()


class SupervisorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        if EXTERNAL_URL:
            self.base = EXTERNAL_URL.rstrip("/")
            self.server_task = None
        else:
            port = 18000 + os.getpid() % 1000
            self.server_task = asyncio.create_task(supervisor.serve_forever("127.0.0.1", port))
            self.base = f"ws://127.0.0.1:{port}"
            for _ in range(50):
                try:
                    await asyncio.to_thread(self._health)
                    break
                except OSError:
                    await asyncio.sleep(0.05)
        self.clients: list[Client] = []

    async def asyncTearDown(self) -> None:
        for c in self.clients:
            await c.close()
        await self._wait_sessions(0)
        if self.server_task is not None:
            self.server_task.cancel()
            try:
                await self.server_task
            except asyncio.CancelledError:
                pass

    def _health(self) -> dict[str, Any]:
        url = self.base.replace("ws://", "http://") + "/healthz"
        with urllib.request.urlopen(url, timeout=2) as r:  # noqa: S310 — http из base
            return json.loads(r.read())

    async def _wait_sessions(self, n: int) -> None:
        for _ in range(100):
            if (await asyncio.to_thread(self._health))["activeSessions"] == n:
                return
            await asyncio.sleep(0.05)
        self.fail(f"activeSessions did not reach {n}")

    async def client(self) -> Client:
        c = Client(await connect(self.base + "/sessions", max_size=None))
        self.clients.append(c)
        return c

    async def test_blink_streams_in_real_time(self) -> None:
        c = await self.client()
        resp = await c.call("start", firmwareHex=BLINK_HEX, circuit=LED_CIRCUIT, speed=1.0)
        self.assertTrue(resp["ok"], resp)
        self.assertEqual(resp["result"]["cycle"], 0)
        await asyncio.sleep(2.4)
        started = c.of_type("simulation_started")
        self.assertEqual(len(started), 1)
        d13 = [
            (wall, e)
            for wall, e in c.events
            if e["type"] == "digital_pin_changed"
            and e["payload"]["pin"] == "D13"
            and e["payload"]["mode"] in ("output-high", "output-low")
        ]
        self.assertGreaterEqual(len(d13), 3, d13)
        # Переключения каждые 1000 мс симулированного времени…
        for (_, a), (_, b) in zip(d13[1:], d13[2:], strict=False):
            self.assertAlmostEqual((b["timestamp"] - a["timestamp"]) / 1000, 1000, delta=5)
            self.assertEqual(b["cycle"] // 16, b["timestamp"])
        # …и примерно каждую секунду настенного времени (темп реального времени).
        walls = [w for w, _ in d13[1:]]
        for a, b in zip(walls, walls[1:], strict=False):
            self.assertAlmostEqual(b - a, 1.0, delta=0.25)
        led = [
            e for e in c.of_type("component_state_changed") if e["payload"]["componentId"] == "led1"
        ]
        self.assertIn(True, [e["payload"]["state"]["on"] for e in led])
        stop = await c.call("stop")
        self.assertTrue(stop["ok"], stop)
        await asyncio.sleep(0.1)
        self.assertEqual(c.of_type("simulation_stopped")[-1]["payload"]["reason"], "client")
        await self._wait_sessions(0)

    async def test_pause_resume_stop(self) -> None:
        c = await self.client()
        self.assertTrue((await c.call("start", firmwareHex=BLINK_HEX, speed=2.0))["ok"])
        await asyncio.sleep(0.3)
        paused = await c.call("pause")
        self.assertTrue(paused["ok"], paused)
        cycle = paused["result"]["cycle"]
        self.assertGreater(cycle, 0)
        n = len(c.batches)
        await asyncio.sleep(0.5)
        self.assertTrue(all(b["cycle"] <= cycle for _, b in c.batches[n - 1 :]))
        self.assertEqual((await c.call("pause"))["error"]["code"], "NOT_RUNNING")
        self.assertTrue((await c.call("resume"))["ok"])
        await asyncio.sleep(0.5)
        self.assertGreater(c.batches[-1][1]["cycle"], cycle)
        # 0,5 с при скорости 2 ≈ 1 с симулированного времени.
        advanced = (c.batches[-1][1]["cycle"] - cycle) / 16_000_000
        self.assertAlmostEqual(advanced, 1.0, delta=0.3)
        reset = await c.call("reset")
        self.assertTrue(reset["ok"], reset)
        await asyncio.sleep(0.1)
        self.assertTrue(c.of_type("simulation_reset"))
        kinds = [e["type"] for _, e in c.events]
        self.assertLess(kinds.index("simulation_paused"), kinds.index("simulation_resumed"))
        self.assertTrue((await c.call("stop"))["ok"])
        self.assertEqual((await c.call("stop"))["error"]["code"], "NOT_STARTED")
        await self._wait_sessions(0)

    async def test_button_input_and_serial(self) -> None:
        c = await self.client()
        start = await c.call("start", firmwareHex=BUTTON_HEX, circuit=BUTTON_CIRCUIT, speed=4.0)
        self.assertTrue(start["ok"], start)
        await asyncio.sleep(0.3)
        press = await c.call("set_component_input", componentId="sw1", input={"pressed": True})
        self.assertTrue(press["ok"], press)
        self.assertTrue(press["result"]["changed"])
        await asyncio.sleep(0.3)
        text = bytes(b for e in c.of_type("serial_output") for b in e["payload"]["bytes"]).decode()
        lines = [x for x in text.split("\r\n") if x]
        self.assertIn("1", lines)
        self.assertEqual(lines[-1], "0")
        # Нажатие применено на границе среза: такт кратен длине среза (плюс перебег одной инструкции).
        slice_cycles = start["result"]["sliceMs"] * 16_000
        self.assertLess(press["result"]["cycle"] % slice_cycles, 8)
        bad = await c.call("set_component_input", componentId="nope", input={"pressed": True})
        self.assertEqual(bad["error"]["code"], "UNKNOWN_COMPONENT")

    async def test_busy_limit(self) -> None:
        limit = (await asyncio.to_thread(self._health))["maxSessions"]
        for _ in range(limit):
            c = await self.client()
            self.assertTrue((await c.call("start", firmwareHex=BLINK_HEX))["ok"])
        extra = await self.client()
        busy = await extra.call("start", firmwareHex=BLINK_HEX)
        self.assertEqual(busy["error"]["code"], "SIMULATOR_BUSY")
        # После освобождения слота новая сессия запускается.
        await self.clients[0].call("stop")
        self.assertTrue((await extra.call("start", firmwareHex=BLINK_HEX))["ok"])

    async def test_disconnect_kills_worker(self) -> None:
        c = await self.client()
        self.assertTrue((await c.call("start", firmwareHex=BLINK_HEX))["ok"])
        await self._wait_sessions(1)
        await c.close()
        self.clients.remove(c)
        await self._wait_sessions(0)

    async def test_invalid_requests(self) -> None:
        c = await self.client()
        self.assertEqual(
            (await c.call("start", firmwareHex=":00000001FE"))["error"]["code"], "INVALID_FIRMWARE"
        )
        self.assertEqual((await c.call("start"))["error"]["code"], "INVALID_ARGUMENT")
        self.assertEqual(
            (await c.call("start", firmwareHex=BLINK_HEX, speed=100))["error"]["code"],
            "INVALID_ARGUMENT",
        )
        self.assertEqual((await c.call("pause"))["error"]["code"], "NOT_STARTED")
        self.assertEqual((await c.call("warp"))["error"]["code"], "UNKNOWN_COMMAND")
        bad_circuit = {**LED_CIRCUIT, "board": {"id": "uno1", "type": "esp32"}}
        resp = await c.call("start", firmwareHex=BLINK_HEX, circuit=bad_circuit)
        self.assertEqual(resp["error"]["code"], "UNSUPPORTED_BOARD")
        await self._wait_sessions(0)


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(EXTERNAL_URL, "проверка внутренней логики — только в процессе теста")
class EventSinkTests(unittest.TestCase):
    def _session(self) -> Any:
        s = supervisor.Session.__new__(supervisor.Session)
        s.cycle = 0
        s.serial_dropped = 0
        s.warned_rate = s.warned_serial = False
        return s

    def test_overflow_coalesces_to_last_state(self) -> None:
        s = self._session()
        sink = supervisor.EventSink(s)
        n = supervisor.MAX_EVENTS_PER_BATCH + 100
        for i in range(n):
            payload = {"pin": "D13", "value": i % 2, "mode": "output-high"}
            sink.add(
                {
                    "version": 1,
                    "type": "digital_pin_changed",
                    "timestamp": i * 16,
                    "payload": payload,
                }
            )
        events = sink.finish()
        pins = [e for e in events if e["type"] == "digital_pin_changed"]
        self.assertEqual(len(pins), supervisor.MAX_EVENTS_PER_BATCH + 1)
        self.assertEqual(pins[-1]["cycle"], (n - 1) * 16)
        self.assertEqual(pins[-1]["timestamp"], n - 1)
        self.assertEqual(events[-1]["payload"]["code"], "EVENT_RATE_LIMITED")

    def test_serial_is_merged_and_rate_limited(self) -> None:
        s = self._session()
        sink = supervisor.EventSink(s)
        budget = sink.serial_budget
        for i in range(budget + 10):
            sink.add(
                {"type": "serial_output", "timestamp": i, "payload": {"port": "Serial", "byte": 65}}
            )
        events = sink.finish()
        self.assertEqual(len(events[0]["payload"]["bytes"]), budget)
        self.assertEqual(s.serial_dropped, 10)
        self.assertEqual(events[-1]["payload"]["code"], "SERIAL_OUTPUT_RATE_LIMITED")
