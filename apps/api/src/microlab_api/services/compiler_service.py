"""Клиент воркера компиляции (services/compiler).

API не запускает arduino-cli сам: компиляция недоверенного кода выполняется только
в изолированном контейнере воркера, API обращается к нему по HTTP.
"""

import asyncio
import hashlib
import json
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError
from pydantic.alias_generators import to_camel

from microlab_api.config import Settings
from microlab_api.domain.compilation.diagnostics import Diagnostic, parse_diagnostics
from microlab_api.schemas.errors import ErrorCode

logger = logging.getLogger(__name__)

# Лимит исходника совпадает с лимитом воркера (COMPILER_MAX_SOURCE_BYTES).
MAX_SOURCE_BYTES = 256 * 1024
# Размер ответа воркера ограничен: HEX до 512 KB + вывод до 64 KB символов.
_MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class CompilerError(Exception):
    """Сбой компиляции как операции (а не ошибка в коде пользователя)."""

    def __init__(self, status_code: int, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _unavailable() -> CompilerError:
    return CompilerError(503, ErrorCode.COMPILER_UNAVAILABLE, "Compiler is unavailable.")


# Коды ошибок воркера → ошибки API.
_WORKER_ERRORS: dict[str, CompilerError] = {
    "SOURCE_TOO_LARGE": CompilerError(413, ErrorCode.SOURCE_TOO_LARGE, "Source is too large."),
    "COMPILER_BUSY": CompilerError(
        503, ErrorCode.COMPILER_BUSY, "Compiler is busy, try again later."
    ),
    "COMPILATION_TIMEOUT": CompilerError(
        504, ErrorCode.COMPILATION_TIMEOUT, "Compilation exceeded the time limit."
    ),
    "OUTPUT_TOO_LARGE": CompilerError(
        422, ErrorCode.COMPILER_OUTPUT_TOO_LARGE, "Compiler output exceeded the size limit."
    ),
}


class _WorkerModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, extra="ignore", frozen=True)


class WorkerSizes(_WorkerModel):
    flash_bytes: int
    flash_max_bytes: int
    ram_bytes: int
    ram_max_bytes: int


class WorkerToolchain(_WorkerModel):
    arduino_cli: str
    platform: str
    fqbn: str


class WorkerResult(_WorkerModel):
    success: bool
    compiler_output: str
    compiler_output_truncated: bool
    hex: str | None
    sizes: WorkerSizes | None
    duration_ms: int
    toolchain: WorkerToolchain


@dataclass(frozen=True, slots=True)
class CompileOutcome:
    result: WorkerResult
    diagnostics: list[Diagnostic]
    firmware_sha256: str | None


# Кэш результатов компиляции: ключ — sha256(toolchain воркера + исходник). Повторный запуск
# без изменений в коде не компилирует скетч заново. Кэшируются только результаты компиляции
# (успех или ошибки в коде), но не сбои воркера. Размер ограничен (LRU).
COMPILE_CACHE_MAX_ENTRIES = 256
# Как часто перечитывать версию toolchain воркера (GET /healthz): после обновления образа
# компилятора старые записи кэша перестают совпадать.
TOOLCHAIN_TTL_SECONDS = 60.0


class CompileCache:
    """Ограниченный LRU-кэш ``ключ → CompileOutcome`` (в памяти процесса)."""

    def __init__(self, max_entries: int = COMPILE_CACHE_MAX_ENTRIES) -> None:
        self._max_entries = max_entries
        self._entries: OrderedDict[str, CompileOutcome] = OrderedDict()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def key(toolchain: str, source: str) -> str:
        digest = hashlib.sha256()
        digest.update(toolchain.encode("utf-8"))
        digest.update(b"\0")
        digest.update(source.encode("utf-8"))
        return digest.hexdigest()

    def get(self, key: str) -> CompileOutcome | None:
        outcome = self._entries.get(key)
        if outcome is None:
            self.misses += 1
            return None
        self._entries.move_to_end(key)
        self.hits += 1
        return outcome

    def put(self, key: str, outcome: CompileOutcome) -> None:
        self._entries[key] = outcome
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def __len__(self) -> int:
        return len(self._entries)


class CompilerClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self._client: httpx.AsyncClient | None = None
        self.cache = CompileCache()
        self._toolchain: str | None = None
        self._toolchain_checked_at = 0.0
        # Одинаковые исходники, отправленные одновременно, компилируются один раз.
        self._inflight: dict[str, asyncio.Future[CompileOutcome]] = {}
        if settings.compiler_url is not None:
            timeout = httpx.Timeout(settings.compiler_timeout_seconds, connect=5.0)
            self._client = httpx.AsyncClient(
                base_url=str(settings.compiler_url),
                timeout=timeout,
                transport=transport,
                # Воркер находится во внутренней сети; прокси окружения не используются.
                trust_env=False,
            )

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def _toolchain_id(self) -> str | None:
        """Версия toolchain воркера (кэшируется на TOOLCHAIN_TTL_SECONDS); None — неизвестна."""
        assert self._client is not None  # noqa: S101 — проверено вызывающим кодом
        now = time.monotonic()
        if self._toolchain is not None and now - self._toolchain_checked_at < TOOLCHAIN_TTL_SECONDS:
            return self._toolchain
        try:
            response = await self._client.get("/healthz", timeout=5.0)
            body = response.json() if response.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            body = None
        if not isinstance(body, dict) or not isinstance(body.get("toolchain"), dict):
            # Воркер занят или недоступен: остаётся последняя известная версия (результат
            # компиляции всё равно сверяется с ней перед записью в кэш).
            return self._toolchain
        self._toolchain = json.dumps(body["toolchain"], sort_keys=True)
        self._toolchain_checked_at = now
        return self._toolchain

    async def compile(self, source: str) -> CompileOutcome:
        if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
            raise _WORKER_ERRORS["SOURCE_TOO_LARGE"]
        if self._client is None:
            raise _unavailable()

        toolchain = await self._toolchain_id()
        if toolchain is None:
            # Версия toolchain неизвестна — без кэша.
            return await self._compile_uncached(source)
        key = CompileCache.key(toolchain, source)
        cached = self.cache.get(key)
        if cached is not None:
            logger.info("sketch compile cache hit")
            return cached
        pending = self._inflight.get(key)
        if pending is not None:
            return await asyncio.shield(pending)

        future: asyncio.Future[CompileOutcome] = asyncio.get_running_loop().create_future()
        self._inflight[key] = future
        try:
            outcome = await self._compile_uncached(source)
        except BaseException as exc:
            future.set_exception(exc)
            # Исключение уже передано ожидающим; если их нет — не выводить предупреждение.
            future.exception()
            raise
        else:
            # Результат с другой версией toolchain (обновление воркера) не кэшируется.
            reported = outcome.result.toolchain.model_dump(by_alias=True)
            current = json.loads(toolchain)
            if all(current.get(name) == value for name, value in reported.items()):
                self.cache.put(key, outcome)
            else:
                self._toolchain = None
            future.set_result(outcome)
            return outcome
        finally:
            self._inflight.pop(key, None)

    async def _compile_uncached(self, source: str) -> CompileOutcome:
        assert self._client is not None  # noqa: S101 — проверено вызывающим кодом
        try:
            response = await self._client.post("/compile", json={"source": source})
        except httpx.TimeoutException:
            raise _WORKER_ERRORS["COMPILATION_TIMEOUT"] from None
        except httpx.HTTPError as exc:
            logger.warning("compiler request failed", extra={"error_type": type(exc).__name__})
            raise _unavailable() from None

        if len(response.content) > _MAX_RESPONSE_BYTES:
            logger.warning("compiler response too large")
            raise _unavailable()
        if response.status_code != 200:
            raise self._map_error(response)
        try:
            result = WorkerResult.model_validate_json(response.content)
        except ValidationError:
            logger.warning("compiler returned invalid response")
            raise _unavailable() from None

        diagnostics = parse_diagnostics(result.compiler_output, failed=not result.success)
        sha256 = (
            hashlib.sha256(result.hex.encode("ascii")).hexdigest()
            if result.success and result.hex is not None
            else None
        )
        logger.info(
            "sketch compiled",
            extra={"success": result.success, "duration_ms": result.duration_ms},
        )
        return CompileOutcome(result=result, diagnostics=diagnostics, firmware_sha256=sha256)

    @staticmethod
    def _map_error(response: httpx.Response) -> CompilerError:
        code: object = None
        try:
            body = response.json()
            if isinstance(body, dict) and isinstance(body.get("error"), dict):
                code = body["error"].get("code")
        except ValueError:
            pass
        mapped = _WORKER_ERRORS.get(code) if isinstance(code, str) else None
        if mapped is None:
            logger.warning(
                "compiler error response",
                extra={"status_code": response.status_code, "worker_code": str(code)},
            )
            return _unavailable()
        return mapped
