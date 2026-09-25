"""Структурированное логирование поверх стандартного модуля ``logging``.

Каждая запись содержит текущий request id (``request_id``) из context variable,
которую request-id middleware устанавливает на время обработки запроса.
"""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any, Final

from microlab_api.config import LogFormat, LogLevel

request_id_var: ContextVar[str | None] = ContextVar("microlab_request_id", default=None)

# Атрибуты, присутствующие в любом LogRecord; всё остальное передано через ``extra=``.
_RESERVED_ATTRS: Final = frozenset(
    vars(logging.LogRecord("", logging.INFO, "", 0, "", None, None)).keys()
    | {"message", "asctime", "request_id", "taskName", "color_message"}
)


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Сохраняем id, явно переданный через ``extra={"request_id": ...}``.
        if getattr(record, "request_id", None) is None:
            record.request_id = request_id_var.get()
        return True


def _extra_fields(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in vars(record).items() if k not in _RESERVED_ATTRS}


class JsonFormatter(logging.Formatter):
    """Один JSON-объект на строку."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        payload.update(_extra_fields(record))
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class ConsoleFormatter(logging.Formatter):
    """Удобочитаемый однострочный формат для локальной разработки."""

    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-8s %(name)s [%(request_id)s] %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        extra = _extra_fields(record)
        if extra:
            line += " " + " ".join(f"{k}={v}" for k, v in sorted(extra.items()))
        return line


def configure_logging(level: LogLevel, fmt: LogFormat) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else ConsoleFormatter())
    handler.addFilter(RequestIdFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Направляем логгеры uvicorn через тот же handler. Строки access-лога пишет наш
    # собственный middleware (с request id), поэтому access-логгер uvicorn отключён.
    for name in ("uvicorn", "uvicorn.error"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False
