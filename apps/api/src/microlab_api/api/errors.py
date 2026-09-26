"""Обработчики исключений, формирующие единый формат ошибок API.

Тело ответа: ``{error: {code, message, details}}``.
"""

import logging
from collections.abc import Mapping
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import InterfaceError, OperationalError
from starlette.exceptions import HTTPException

from microlab_api.api.middleware import (
    REQUEST_ID_HEADER,
    get_request_id,
    internal_error_response,
)
from microlab_api.schemas.errors import ErrorBody, ErrorCode, ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)

_HTTP_STATUS_CODES: dict[int, ErrorCode] = {
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    422: ErrorCode.VALIDATION_ERROR,
}

# Сбои подключения к базе данных. Ошибки запросов (например, IntegrityError) сюда не входят:
# это баги или конфликты, а не недоступность.
DATABASE_UNAVAILABLE_ERRORS: tuple[type[Exception], ...] = (
    OperationalError,
    InterfaceError,
    ConnectionError,
    TimeoutError,
)


class ApiError(Exception):
    """Ошибка запроса со стабильным кодом; преобразуется в конверт ошибки API."""

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        details: list[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or []


def error_response(
    status_code: int,
    code: ErrorCode,
    message: str,
    details: list[ErrorDetail] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, details=details or []))
    return JSONResponse(
        status_code=status_code, content=body.model_dump(mode="json"), headers=headers
    )


def _status_message(status_code: int) -> str:
    try:
        return f"{HTTPStatus(status_code).phrase}."
    except ValueError:
        return "HTTP error."


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, HTTPException):
        raise exc
    code = _HTTP_STATUS_CODES.get(exc.status_code, ErrorCode.HTTP_ERROR)
    return error_response(
        exc.status_code, code, _status_message(exc.status_code), headers=exc.headers
    )


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, ApiError):
        raise exc
    return error_response(exc.status_code, exc.code, exc.message, exc.details)


def _field_path(loc: tuple[int | str, ...]) -> str:
    return ".".join(str(part) for part in loc)


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        raise exc
    details = [
        ErrorDetail(
            field=_field_path(tuple(err.get("loc", ()))),
            message=str(err.get("msg", "")),
            code=str(err.get("type", "invalid")),
        )
        for err in exc.errors()
    ]
    return error_response(422, ErrorCode.VALIDATION_ERROR, "Request validation failed.", details)


async def database_unavailable_handler(request: Request, exc: Exception) -> JSONResponse:
    # Сообщения драйвера могут содержать параметры подключения: логируем только тип исключения.
    logger.warning("database unavailable", extra={"error_type": type(exc).__name__})
    return error_response(503, ErrorCode.DATABASE_UNAVAILABLE, "Database is unavailable.")


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Запасной обработчик: обычно необработанные исключения преобразует ``RequestIdMiddleware``.

    Срабатывает, только если упал сам middleware. После этого обработчика Starlette
    пробрасывает исключение дальше.
    """
    logger.error(
        "unhandled exception",
        extra={"error_type": type(exc).__name__, "request_id": get_request_id(request.scope)},
    )
    request_id = get_request_id(request.scope)
    response = internal_error_response()
    if request_id:
        response.headers[REQUEST_ID_HEADER] = request_id
    return response


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    for exc_type in DATABASE_UNAVAILABLE_ERRORS:
        app.add_exception_handler(exc_type, database_unavailable_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
