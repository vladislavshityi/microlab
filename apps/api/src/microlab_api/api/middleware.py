"""Проброс request id, access-лог и последний рубеж для 500 (чистый ASGI middleware)."""

import logging
import re
import time
import uuid
from typing import Final

from starlette.datastructures import MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from microlab_api.logging import request_id_var
from microlab_api.schemas.errors import ErrorBody, ErrorCode, ErrorResponse

REQUEST_ID_HEADER: Final = "X-Request-ID"
# Принимаем id от клиента, только если он короткий и безопасен для заголовков/логов.
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._\-]{1,128}$")

access_logger = logging.getLogger("microlab_api.access")
error_logger = logging.getLogger("microlab_api.errors")


def _incoming_request_id(scope: Scope) -> str | None:
    for name, value in scope["headers"]:
        if name == b"x-request-id":
            candidate = value.decode("latin-1")
            return candidate if _VALID_REQUEST_ID.match(candidate) else None
    return None


def get_request_id(scope: Scope) -> str | None:
    state = scope.get("state") or {}
    request_id = state.get("request_id")
    return request_id if isinstance(request_id, str) else None


def internal_error_response() -> JSONResponse:
    body = ErrorResponse(
        error=ErrorBody(code=ErrorCode.INTERNAL_ERROR, message="Internal server error.", details=[])
    )
    return JSONResponse(status_code=500, content=body.model_dump(mode="json"))


class RequestIdMiddleware:
    """Назначает request id и передаёт его в ``X-Request-ID`` и в контекст логирования.

    Необработанные исключения преобразуются здесь в конверт 500, пока request id ещё
    находится в контексте логирования. Логируется только тип исключения (сообщение может
    содержать секреты), и исключение не пробрасывается дальше, поэтому ни
    ``ServerErrorMiddleware`` из Starlette, ни uvicorn не пишут второй traceback с текстом
    исключения.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _incoming_request_id(scope) or uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as exc:  # последний рубеж обработки для всего приложения
            # Traceback намеренно не пишем: сообщения исключений могут содержать секреты.
            error_logger.error(
                "unhandled exception",
                extra={"error_type": type(exc).__name__, "response_started": response_started},
            )
            if not response_started:
                await internal_error_response()(scope, receive, send_with_request_id)
        finally:
            access_logger.info(
                "request completed",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status_code": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            request_id_var.reset(token)
