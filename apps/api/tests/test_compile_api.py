"""POST /api/v1/compile с подменённым воркером (httpx.MockTransport)."""

import hashlib
import json
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from microlab_api.app import create_app
from microlab_api.config import Settings
from microlab_api.services.compiler_service import MAX_SOURCE_BYTES, CompilerClient
from tests.conftest import CSRF_HEADERS, authenticate_as, fake_student

pytestmark = pytest.mark.anyio

FIXTURES = Path(__file__).parent / "fixtures" / "compiler"
TOOLCHAIN = {"arduinoCli": "1.5.1", "platform": "arduino:avr@1.8.8", "fqbn": "arduino:avr:uno"}
HEX = ":00000001FF\n"
SIZES = {"flashBytes": 924, "flashMaxBytes": 32256, "ramBytes": 9, "ramMaxBytes": 2048}

type Handler = Callable[[httpx.Request], httpx.Response]


def worker_result(*, success: bool, output: str, hex_text: str | None = None) -> dict[str, object]:
    return {
        "success": success,
        "compilerOutput": output,
        "compilerOutputTruncated": False,
        "hex": hex_text,
        "sizes": SIZES if success else None,
        "durationMs": 700,
        "toolchain": TOOLCHAIN,
    }


def worker_error(status: int, code: str) -> httpx.Response:
    return httpx.Response(status, json={"error": {"code": code, "message": "x"}})


@pytest.fixture
def make_client(unreachable_settings: Settings) -> Callable[[Handler], AsyncClient]:
    def factory(handler: Handler) -> AsyncClient:
        settings = unreachable_settings.model_copy(
            update={"compiler_url": "http://compiler.test:8080"}
        )
        app = create_app(settings)
        authenticate_as(app, fake_student())
        app.state.compiler = CompilerClient(settings, transport=httpx.MockTransport(handler))
        return AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://testserver",
            headers=CSRF_HEADERS,
        )

    return factory


@pytest.fixture
def requests_seen() -> list[httpx.Request]:
    return []


async def test_success_returns_firmware_sizes_and_warnings(
    make_client: Callable[[Handler], AsyncClient], requests_seen: list[httpx.Request]
) -> None:
    output = (FIXTURES / "warning_only.txt").read_text(encoding="utf-8")

    def handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        return httpx.Response(200, json=worker_result(success=True, output=output, hex_text=HEX))

    async with make_client(handler) as client:
        response = await client.post("/api/v1/compile", json={"code": "void setup(){}"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["firmware"] == {
        "format": "ihex",
        "data": HEX,
        "sha256": hashlib.sha256(HEX.encode()).hexdigest(),
    }
    assert body["sizes"] == SIZES
    assert body["toolchain"] == TOOLCHAIN
    assert [d["severity"] for d in body["diagnostics"]] == ["warning", "warning"]
    assert body["diagnostics"][0] == {
        "file": "sketch.ino",
        "line": 2,
        "column": 7,
        "severity": "warning",
        "message": "unused variable 'x' [-Wunused-variable]",
    }
    # Воркер получает исходник в поле source; в URL и заголовках его нет.
    (sent,) = requests_seen
    assert sent.url.path == "/compile"
    assert json.loads(sent.content) == {"source": "void setup(){}"}


async def test_compile_error_is_a_result_not_an_api_error(
    make_client: Callable[[Handler], AsyncClient],
) -> None:
    output = (FIXTURES / "syntax_error.txt").read_text(encoding="utf-8")

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=worker_result(success=False, output=output))

    async with make_client(handler) as client:
        response = await client.post("/api/v1/compile", json={"code": "void setup() {"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "error"
    assert body["firmware"] is None
    assert body["sizes"] is None
    assert body["compilerOutput"] == output
    assert [(d["line"], d["severity"]) for d in body["diagnostics"]] == [
        (4, "error"),
        (8, "error"),
        (7, "warning"),
    ]


@pytest.mark.parametrize(
    ("worker_response", "status", "code"),
    [
        (worker_error(503, "COMPILER_BUSY"), 503, "COMPILER_BUSY"),
        (worker_error(504, "COMPILATION_TIMEOUT"), 504, "COMPILATION_TIMEOUT"),
        (worker_error(413, "SOURCE_TOO_LARGE"), 413, "SOURCE_TOO_LARGE"),
        (worker_error(500, "OUTPUT_TOO_LARGE"), 422, "COMPILER_OUTPUT_TOO_LARGE"),
        (worker_error(500, "INTERNAL_ERROR"), 503, "COMPILER_UNAVAILABLE"),
        (httpx.Response(502, text="Bad Gateway"), 503, "COMPILER_UNAVAILABLE"),
        (httpx.Response(200, json={"unexpected": True}), 503, "COMPILER_UNAVAILABLE"),
    ],
)
async def test_worker_errors_map_to_stable_codes(
    make_client: Callable[[Handler], AsyncClient],
    worker_response: httpx.Response,
    status: int,
    code: str,
) -> None:
    async with make_client(lambda _request: worker_response) as client:
        response = await client.post("/api/v1/compile", json={"code": "void setup(){}"})

    assert response.status_code == status
    assert response.json()["error"]["code"] == code


async def test_connection_failure_is_compiler_unavailable(
    make_client: Callable[[Handler], AsyncClient],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async with make_client(handler) as client:
        response = await client.post("/api/v1/compile", json={"code": "void setup(){}"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "COMPILER_UNAVAILABLE"


async def test_client_timeout_is_compilation_timeout(
    make_client: Callable[[Handler], AsyncClient],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    async with make_client(handler) as client:
        response = await client.post("/api/v1/compile", json={"code": "void setup(){}"})

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "COMPILATION_TIMEOUT"


async def test_source_too_large_is_rejected_before_worker(
    make_client: Callable[[Handler], AsyncClient], requests_seen: list[httpx.Request]
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        return httpx.Response(500)

    # Кириллица занимает 2 байта в UTF-8: лимит считается в байтах, а не в символах.
    code = "я" * (MAX_SOURCE_BYTES // 2 + 1)
    async with make_client(handler) as client:
        response = await client.post("/api/v1/compile", json={"code": code})

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "SOURCE_TOO_LARGE"
    assert requests_seen == []


async def test_compiler_not_configured(unreachable_settings: Settings) -> None:
    app = create_app(unreachable_settings.model_copy(update={"compiler_url": None}))
    authenticate_as(app, fake_student())
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
        headers=CSRF_HEADERS,
    ) as client:
        response = await client.post("/api/v1/compile", json={"code": "void setup(){}"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "COMPILER_UNAVAILABLE"


async def test_missing_code_is_validation_error(
    make_client: Callable[[Handler], AsyncClient],
) -> None:
    async with make_client(lambda _request: httpx.Response(500)) as client:
        response = await client.post("/api/v1/compile", json={})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
