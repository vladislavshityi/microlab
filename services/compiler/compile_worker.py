"""Изолированный воркер компиляции Arduino-скетчей (только стандартная библиотека Python).

HTTP API (внутренняя сеть, без аутентификации — доступен только backend):

* ``GET /healthz`` — версия toolchain;
* ``POST /compile`` — ``{"source": "<текст sketch.ino>"}`` → результат компиляции.

Каждая компиляция выполняется в новой временной директории на tmpfs, отдельной группе
процессов, с жёстким таймаутом и лимитами ресурсов (``prlimit``). Пользовательский текст
записывается только в файл ``sketch/sketch.ino`` и никогда не попадает в командную строку
или shell. Профиль сборки ``sketch.yaml`` фиксирует FQBN и версию платформы; каталог
пользовательских библиотек пуст: кроме библиотек платформы в сборке участвует только
закреплённая в профиле библиотека Servo 1.3.0.

Выбор stdlib вместо FastAPI: в образе нет ни одной сторонней Python-зависимости,
а API воркера состоит из двух маршрутов.
"""

import contextlib
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


def _env_int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


ARDUINO_CLI = os.environ.get("COMPILER_ARDUINO_CLI", "/usr/local/bin/arduino-cli")
ARDUINO_CONFIG = os.environ.get("COMPILER_ARDUINO_CONFIG", "/opt/arduino/arduino-cli.yaml")
ARDUINO_DATA_DIR = os.environ.get("COMPILER_ARDUINO_DATA_DIR", "/opt/arduino/data")
SKETCH_PROFILE = Path(os.environ.get("COMPILER_SKETCH_PROFILE", "/opt/arduino/sketch.yaml"))
WORK_ROOT = os.environ.get("COMPILER_WORK_ROOT", "/work")
PORT = _env_int("COMPILER_PORT", 8080)

ARDUINO_CLI_VERSION = os.environ.get("COMPILER_ARDUINO_CLI_VERSION", "unknown")
PLATFORM = "arduino:avr@1.8.8"
FQBN = "arduino:avr:uno"
PROFILE = "uno"

MAX_SOURCE_BYTES = _env_int("COMPILER_MAX_SOURCE_BYTES", 256 * 1024)
# Запас на JSON-экранирование исходника.
MAX_BODY_BYTES = MAX_SOURCE_BYTES * 6 + 1024
TIMEOUT_SECONDS = _env_int("COMPILER_TIMEOUT_SECONDS", 60)
MAX_CONCURRENT = _env_int("COMPILER_MAX_CONCURRENT", 2)
QUEUE_WAIT_SECONDS = _env_int("COMPILER_QUEUE_WAIT_SECONDS", 10)
MAX_OUTPUT_CHARS = _env_int("COMPILER_MAX_OUTPUT_CHARS", 64 * 1024)
# Полный flash UNO в Intel HEX занимает около 90 KB.
MAX_HEX_BYTES = 512 * 1024
MAX_STDOUT_BYTES = 16 * 1024 * 1024
JOBS = _env_int("COMPILER_JOBS", 2)

# Лимиты на каждый процесс сборки (arduino-cli, avr-gcc, ld, ctags).
LIMITS = (
    f"--cpu={TIMEOUT_SECONDS}",
    f"--as={_env_int('COMPILER_LIMIT_AS_BYTES', 2 * 1024**3)}",
    f"--fsize={_env_int('COMPILER_LIMIT_FSIZE_BYTES', 32 * 1024**2)}",
    f"--nproc={_env_int('COMPILER_LIMIT_NPROC', 256)}",
    "--nofile=256",
    "--core=0",
)

logger = logging.getLogger("compiler")
_slots = threading.BoundedSemaphore(MAX_CONCURRENT)


class WorkerError(Exception):
    def __init__(self, status: HTTPStatus, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _truncate(text: str) -> tuple[str, bool]:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text, False
    return text[:MAX_OUTPUT_CHARS] + "\n[output truncated]\n", True


_PLATFORM_DIR = re.compile(r"internal/arduino_avr_1\.8\.8_[0-9a-f]+/")
_SKETCH_USES = re.compile(r"Sketch uses (\d+) bytes .*?Maximum is (\d+) bytes")
_GLOBALS_USE = re.compile(r"Global variables use (\d+) bytes .*?Maximum is (\d+) bytes")


def _sanitize(text: str, work_dir: str) -> str:
    """Убирает из вывода внутренние пути.

    Файл скетча становится ``sketch.ino``, файлы ядра — ``arduino-avr-1.8.8/...``.
    """
    text = text.replace(f"{work_dir}/sketch/", "")
    text = text.replace(f"{work_dir}/build/", "")
    text = text.replace(f"{work_dir}/", "")
    text = text.replace(f"{ARDUINO_DATA_DIR}/", "")
    return _PLATFORM_DIR.sub("arduino-avr-1.8.8/", text)


def _session_members(session_id: int) -> list[int]:
    members = []
    for entry in os.scandir("/proc"):
        if not entry.name.isdigit():
            continue
        try:
            with open(f"/proc/{entry.name}/stat", "rb") as stat_file:
                stat = stat_file.read()
        except (FileNotFoundError, ProcessLookupError):
            # Процесс завершился между scandir и чтением (параллельные сборки).
            continue
        # Поля после "(comm)": state ppid pgrp session ...
        fields = stat[stat.rindex(b")") + 2 :].split()
        if int(fields[3]) == session_id and fields[0] != b"Z":
            members.append(int(entry.name))
    return members


def _kill_session(session_id: int) -> None:
    """Завершает все процессы сессии компиляции, включая осиротевшие.

    arduino-cli запускает avr-gcc в отдельных группах процессов, поэтому ``killpg``
    недостаточно. Все процессы сборки остаются в сессии, созданной для компиляции
    (``start_new_session``); идентификатор сессии не переиспользуется, пока в ней есть
    процессы. Поиск повторяется, пока в сессии не останется живых процессов.
    """
    for _ in range(100):
        members = _session_members(session_id)
        if not members:
            return
        for pid in members:
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGKILL)
        time.sleep(0.02)
    logger.error("compile processes survived SIGKILL")


def _sizes(builder_result: dict[str, Any], compiler_out: str) -> dict[str, int] | None:
    """Размеры секций; при переполнении flash arduino-cli сообщает их только текстом."""
    sections = {s.get("name"): s for s in builder_result.get("executable_sections_size") or []}
    text, data = sections.get("text"), sections.get("data")
    if text is None or data is None:
        flash = _SKETCH_USES.search(compiler_out)
        ram = _GLOBALS_USE.search(compiler_out)
        if flash is None or ram is None:
            return None
        return {
            "flashBytes": int(flash[1]),
            "flashMaxBytes": int(flash[2]),
            "ramBytes": int(ram[1]),
            "ramMaxBytes": int(ram[2]),
        }
    return {
        "flashBytes": int(text.get("size", 0)),
        "flashMaxBytes": int(text.get("max_size", 0)),
        "ramBytes": int(data.get("size", 0)),
        "ramMaxBytes": int(data.get("max_size", 0)),
    }


def compile_source(source: str) -> dict[str, Any]:
    started = time.monotonic()
    work_dir = tempfile.mkdtemp(prefix="c-", dir=WORK_ROOT)
    try:
        root = Path(work_dir)
        sketch_dir = root / "sketch"
        build_dir = root / "build"
        for directory in (sketch_dir, build_dir, root / "tmp", root / "home"):
            directory.mkdir()
        (sketch_dir / "sketch.ino").write_text(source, encoding="utf-8")
        shutil.copyfile(SKETCH_PROFILE, sketch_dir / "sketch.yaml")

        argv = [
            "prlimit",
            *LIMITS,
            "--",
            ARDUINO_CLI,
            "--config-file",
            ARDUINO_CONFIG,
            "compile",
            "--profile",
            PROFILE,
            "--build-path",
            str(build_dir),
            # -Wall: предупреждения для кода скетча без шума из файлов ядра.
            "--warnings",
            "more",
            "--jobs",
            str(JOBS),
            "--format",
            "json",
            str(sketch_dir),
        ]
        # Чистое окружение: переменные ARDUINO_* из окружения воркера не влияют на сборку.
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": str(root / "home"),
            "TMPDIR": str(root / "tmp"),
            "LANG": "C.UTF-8",
        }
        stdout_path = root / "stdout.json"
        stderr_path = root / "stderr.txt"
        with stdout_path.open("wb") as out, stderr_path.open("wb") as err:
            process = subprocess.Popen(  # noqa: S603 — фиксированный argv, без shell
                argv,
                stdin=subprocess.DEVNULL,
                stdout=out,
                stderr=err,
                cwd=work_dir,
                env=env,
                start_new_session=True,
            )
            try:
                process.wait(timeout=TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                _kill_session(process.pid)
                process.wait()
                raise WorkerError(
                    HTTPStatus.GATEWAY_TIMEOUT,
                    "COMPILATION_TIMEOUT",
                    f"Compilation exceeded {TIMEOUT_SECONDS} s.",
                ) from None
            finally:
                # Дочерние процессы не должны пережить компиляцию.
                _kill_session(process.pid)

        if stdout_path.stat().st_size > MAX_STDOUT_BYTES:
            raise WorkerError(
                HTTPStatus.INTERNAL_SERVER_ERROR, "OUTPUT_TOO_LARGE", "Compiler output too large."
            )
        try:
            result: dict[str, Any] = json.loads(stdout_path.read_bytes() or b"{}")
        except json.JSONDecodeError:
            result = {}
        stderr_text = stderr_path.read_bytes()[:MAX_OUTPUT_CHARS].decode("utf-8", "replace")

        parts = [result.get("compiler_out") or "", result.get("compiler_err") or ""]
        success = bool(result.get("success")) and process.returncode == 0
        if not success:
            parts.append(result.get("error") or "")
            parts.append(stderr_text)
        output, truncated = _truncate(_sanitize("".join(p for p in parts if p), work_dir))

        # Intel HEX воспроизводим (одинаков для одинакового исходника); ELF — нет:
        # отладочная информация содержит путь временной директории.
        hex_text: str | None = None
        if success:
            hex_path = build_dir / "sketch.ino.hex"
            if hex_path.stat().st_size > MAX_HEX_BYTES:
                raise WorkerError(
                    HTTPStatus.INTERNAL_SERVER_ERROR, "OUTPUT_TOO_LARGE", "Firmware too large."
                )
            hex_text = hex_path.read_text(encoding="ascii")

        return {
            "success": success,
            "compilerOutput": output,
            "compilerOutputTruncated": truncated,
            "hex": hex_text,
            "sizes": _sizes(result.get("builder_result") or {}, result.get("compiler_out") or ""),
            "durationMs": int((time.monotonic() - started) * 1000),
            "toolchain": toolchain(),
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def toolchain() -> dict[str, str]:
    return {"arduinoCli": ARDUINO_CLI_VERSION, "platform": PLATFORM, "fqbn": FQBN}


class Handler(BaseHTTPRequestHandler):
    server_version = "microlab-compiler"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:
        # Журнал доступа без тела запроса: исходный код пользователя не логируется.
        logger.info("%s %s", self.address_string(), format % args)

    def _send(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, error: WorkerError) -> None:
        self._send(error.status, {"error": {"code": error.code, "message": error.message}})

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send(HTTPStatus.OK, {"status": "ok", "toolchain": toolchain()})
        else:
            self._error(WorkerError(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Not found."))

    def do_POST(self) -> None:
        try:
            if self.path != "/compile":
                raise WorkerError(HTTPStatus.NOT_FOUND, "NOT_FOUND", "Not found.")
            source = self._read_source()
            if not _slots.acquire(timeout=QUEUE_WAIT_SECONDS):
                raise WorkerError(
                    HTTPStatus.SERVICE_UNAVAILABLE, "COMPILER_BUSY", "Compiler is busy."
                )
            try:
                result = compile_source(source)
            finally:
                _slots.release()
            logger.info(
                "compiled success=%s duration_ms=%s", result["success"], result["durationMs"]
            )
            self._send(HTTPStatus.OK, result)
        except WorkerError as error:
            logger.info("compile rejected code=%s", error.code)
            self._error(error)
        except Exception:
            logger.exception("compile failed")
            self._error(
                WorkerError(HTTPStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Internal error.")
            )

    def _read_source(self) -> str:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise WorkerError(
                HTTPStatus.LENGTH_REQUIRED, "INVALID_REQUEST", "Content-Length required."
            ) from None
        if length > MAX_BODY_BYTES:
            # Тело не читаем; соединение закрывается после ответа.
            self.close_connection = True
            raise WorkerError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "SOURCE_TOO_LARGE", "Source is too large."
            )
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise WorkerError(HTTPStatus.BAD_REQUEST, "INVALID_REQUEST", "Invalid JSON.") from None
        source = body.get("source") if isinstance(body, dict) else None
        if not isinstance(source, str):
            raise WorkerError(HTTPStatus.BAD_REQUEST, "INVALID_REQUEST", "Field 'source' required.")
        if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise WorkerError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "SOURCE_TOO_LARGE", "Source is too large."
            )
        return source


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout
    )
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)  # noqa: S104 — внутренняя сеть
    server.daemon_threads = True
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown).start())
    logger.info("listening port=%s toolchain=%s", PORT, toolchain())
    server.serve_forever()


if __name__ == "__main__":
    main()
