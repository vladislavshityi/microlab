"""Отчёт о состоянии сервиса. Не конверт ошибки: 503 тоже возвращает эту модель."""

from typing import Literal

from pydantic.json_schema import SkipJsonSchema

from microlab_api.schemas.base import ApiModel


class DatabaseCheck(ApiModel):
    status: Literal["ok", "error"]
    # Присутствует только при status == "error"; иначе опускается (никогда не null).
    code: Literal["DATABASE_UNAVAILABLE"] | SkipJsonSchema[None] = None


class HealthChecks(ApiModel):
    database: DatabaseCheck


class HealthResponse(ApiModel):
    status: Literal["ok", "unavailable"]
    version: str
    checks: HealthChecks
