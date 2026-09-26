"""Кэш результатов компиляции CompilerClient (httpx.MockTransport вместо воркера)."""

import asyncio

import httpx
import pytest

from microlab_api.config import Settings
from microlab_api.services.compiler_service import CompileCache, CompilerClient

pytestmark = pytest.mark.anyio

TOOLCHAIN = {"arduinoCli": "1.5.1", "platform": "arduino:avr@1.8.8", "fqbn": "arduino:avr:uno"}


def _result(success: bool = True, toolchain: dict[str, str] = TOOLCHAIN) -> dict[str, object]:
    return {
        "success": success,
        "compilerOutput": "" if success else "sketch.ino:1:1: error: x",
        "compilerOutputTruncated": False,
        "hex": ":00000001FF\n" if success else None,
        "sizes": None,
        "durationMs": 700,
        "toolchain": toolchain,
    }


class FakeWorker:
    def __init__(self) -> None:
        self.compiles = 0
        self.toolchain: dict[str, str] = dict(TOOLCHAIN)
        self.healthy = True
        self.fail_with: int | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/healthz":
            if not self.healthy:
                return httpx.Response(503)
            return httpx.Response(200, json={"status": "ok", "toolchain": self.toolchain})
        self.compiles += 1
        if self.fail_with is not None:
            return httpx.Response(
                self.fail_with, json={"error": {"code": "COMPILER_BUSY", "message": "x"}}
            )
        return httpx.Response(200, json=_result(toolchain=self.toolchain))


@pytest.fixture
def worker() -> FakeWorker:
    return FakeWorker()


@pytest.fixture
def client(unreachable_settings: Settings, worker: FakeWorker) -> CompilerClient:
    settings = unreachable_settings.model_copy(update={"compiler_url": "http://compiler.test:8080"})
    return CompilerClient(settings, transport=httpx.MockTransport(worker.handler))


async def test_repeated_source_is_served_from_cache(
    client: CompilerClient, worker: FakeWorker
) -> None:
    first = await client.compile("void setup(){}")
    second = await client.compile("void setup(){}")
    assert worker.compiles == 1
    assert second is first
    assert client.cache.hits == 1


async def test_changed_source_is_compiled_again(client: CompilerClient, worker: FakeWorker) -> None:
    await client.compile("void setup(){}")
    await client.compile("void setup(){ }")
    assert worker.compiles == 2


async def test_worker_errors_are_not_cached(client: CompilerClient, worker: FakeWorker) -> None:
    worker.fail_with = 503
    for _ in range(2):
        with pytest.raises(Exception):  # noqa: B017, PT011 — CompilerError
            await client.compile("void setup(){}")
    assert worker.compiles == 2
    assert len(client.cache) == 0


async def test_toolchain_change_invalidates_cache(
    client: CompilerClient, worker: FakeWorker
) -> None:
    await client.compile("void setup(){}")
    worker.toolchain = {**TOOLCHAIN, "platform": "arduino:avr@9.9.9"}
    client._toolchain_checked_at = 0.0  # истёк TTL версии toolchain
    await client.compile("void setup(){}")
    assert worker.compiles == 2


async def test_unknown_toolchain_disables_cache(client: CompilerClient, worker: FakeWorker) -> None:
    worker.healthy = False
    await client.compile("void setup(){}")
    await client.compile("void setup(){}")
    assert worker.compiles == 2


async def test_concurrent_identical_sources_compile_once(
    client: CompilerClient, worker: FakeWorker
) -> None:
    results = await asyncio.gather(*(client.compile("void loop(){}") for _ in range(5)))
    assert worker.compiles == 1
    assert all(r is results[0] for r in results)


def test_lru_is_bounded_and_keys_depend_on_toolchain() -> None:
    cache = CompileCache(max_entries=2)
    assert CompileCache.key("a", "src") != CompileCache.key("b", "src")
    assert CompileCache.key("a", "src") == CompileCache.key("a", "src")
    sentinel = object()
    for key in ("k1", "k2"):
        cache.put(key, sentinel)  # type: ignore[arg-type]
    assert cache.get("k1") is sentinel  # k1 становится самым свежим
    cache.put("k3", sentinel)  # type: ignore[arg-type]
    assert cache.get("k2") is None
    assert cache.get("k1") is sentinel
    assert len(cache) == 2


async def test_known_toolchain_survives_healthz_failure(
    client: CompilerClient, worker: FakeWorker
) -> None:
    await client.compile("void setup(){}")
    worker.healthy = False
    client._toolchain_checked_at = 0.0
    await client.compile("void setup(){}")
    assert worker.compiles == 1
