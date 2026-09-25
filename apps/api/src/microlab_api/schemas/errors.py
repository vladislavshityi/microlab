"""Единый формат ошибок API: ``{error: {code, message, details}}``."""

from enum import StrEnum

from microlab_api.schemas.base import ApiModel


# Docstring намеренно на английском: он попадает в OpenAPI (description схемы ErrorCode)
# и в сгенерированные типы frontend, а тексты публичного API — на английском.
class ErrorCode(StrEnum):
    """Stable machine-readable error codes. The UI relies only on these values."""

    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    HTTP_ERROR = "HTTP_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE"
    UNKNOWN_COMPONENT_TYPE = "UNKNOWN_COMPONENT_TYPE"
    SOURCE_TOO_LARGE = "SOURCE_TOO_LARGE"
    COMPILER_UNAVAILABLE = "COMPILER_UNAVAILABLE"
    COMPILER_BUSY = "COMPILER_BUSY"
    COMPILATION_TIMEOUT = "COMPILATION_TIMEOUT"
    COMPILER_OUTPUT_TOO_LARGE = "COMPILER_OUTPUT_TOO_LARGE"


class ErrorDetail(ApiModel):
    field: str
    message: str
    code: str


class ErrorBody(ApiModel):
    code: ErrorCode
    message: str
    details: list[ErrorDetail]


class ErrorResponse(ApiModel):
    error: ErrorBody
