"""Компиляция Arduino-скетча для Arduino UNO R3 (arduino:avr:uno, arduino:avr 1.8.8).

Эндпоинт без состояния компилирует переданный код; эндпоинт в контексте проекта
(``POST /projects/{id}/compile``) компилирует сохранённый код проекта через
:func:`run_compilation`.

Ошибки в коде пользователя — это результат компиляции, а не сбой запроса: ответ 200
со ``status: "error"`` и диагностиками. Коды 4xx/5xx означают, что компиляцию выполнить
не удалось (исходник слишком большой, воркер недоступен или занят, превышено время).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from microlab_api.api.current_user import CurrentUser
from microlab_api.api.errors import error_response
from microlab_api.auth.rate_limit import RateLimits
from microlab_api.schemas.compile import (
    CompileDiagnostic,
    CompileRequest,
    CompileResponse,
    CompileSizes,
    Firmware,
    Toolchain,
)
from microlab_api.schemas.errors import ErrorResponse
from microlab_api.services.compiler_service import CompileOutcome, CompilerClient, CompilerError

router = APIRouter(tags=["compile"])


def get_compiler(request: Request) -> CompilerClient:
    compiler: CompilerClient = request.app.state.compiler
    return compiler


COMPILE_RESPONSES: dict[int | str, dict[str, Any]] = {
    413: {"model": ErrorResponse, "description": "Source exceeds 256 KiB (SOURCE_TOO_LARGE)."},
    401: {"model": ErrorResponse, "description": "Not logged in (AUTH_REQUIRED)."},
    403: {
        "model": ErrorResponse,
        "description": "CSRF_FAILED or PASSWORD_CHANGE_REQUIRED.",
    },
    422: {"model": ErrorResponse, "description": "Invalid request or oversized compiler output."},
    429: {
        "model": ErrorResponse,
        "description": "Per-user compile rate limit exceeded (RATE_LIMITED).",
    },
    500: {"model": ErrorResponse, "description": "Unexpected server error."},
    503: {
        "model": ErrorResponse,
        "description": "Compiler is unavailable (COMPILER_UNAVAILABLE) or busy (COMPILER_BUSY).",
    },
    504: {"model": ErrorResponse, "description": "Time limit exceeded (COMPILATION_TIMEOUT)."},
}


@router.post(
    "/compile",
    response_model=CompileResponse,
    responses=COMPILE_RESPONSES,
    summary="Compile an Arduino sketch for Arduino UNO R3",
    operation_id="compileSketch",
)
async def compile_sketch(
    body: CompileRequest,
    request: Request,
    user: CurrentUser,
    compiler: Annotated[CompilerClient, Depends(get_compiler)],
) -> CompileResponse | JSONResponse:
    check_compile_rate(request, user.id)
    return await run_compilation(compiler, body.code)


def check_compile_rate(request: Request, user_id: object) -> None:
    """Квота компиляций пользователя в минуту (429 RATE_LIMITED)."""
    limits: RateLimits = request.app.state.rate_limits
    limits.compile.check_and_hit(str(user_id))


async def run_compilation(compiler: CompilerClient, code: str) -> CompileResponse | JSONResponse:
    try:
        outcome = await compiler.compile(code)
    except CompilerError as exc:
        return error_response(exc.status_code, exc.code, exc.message)
    return compile_response(outcome)


def compile_response(outcome: CompileOutcome) -> CompileResponse:
    result = outcome.result
    firmware = (
        Firmware(format="ihex", data=result.hex, sha256=outcome.firmware_sha256)
        if result.success and result.hex is not None and outcome.firmware_sha256 is not None
        else None
    )
    return CompileResponse(
        status="success" if result.success else "error",
        diagnostics=[
            CompileDiagnostic(
                file=d.file, line=d.line, column=d.column, severity=d.severity, message=d.message
            )
            for d in outcome.diagnostics
        ],
        sizes=CompileSizes(**result.sizes.model_dump()) if result.sizes else None,
        firmware=firmware,
        compiler_output=result.compiler_output,
        compiler_output_truncated=result.compiler_output_truncated,
        toolchain=Toolchain(**result.toolchain.model_dump()),
        duration_ms=result.duration_ms,
    )
