"""Настройка OpenAPI: ошибки валидации документируются единым форматом ошибок API.

FastAPI описывает ответы 422 собственной моделью ``HTTPValidationError``, но API
возвращает ``ErrorResponse`` (см. ``api/errors.py``). Поэтому ссылки переписываются,
а схемы валидации FastAPI удаляются.
"""

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from microlab_api.schemas.errors import ErrorResponse

_FASTAPI_VALIDATION_SCHEMAS = ("HTTPValidationError", "ValidationError")
_ERROR_REF = f"#/components/schemas/{ErrorResponse.__name__}"


def _rewrite_refs(node: Any) -> Any:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.rsplit("/", 1)[-1] in _FASTAPI_VALIDATION_SCHEMAS:
            return {**node, "$ref": _ERROR_REF}
        return {key: _rewrite_refs(value) for key, value in node.items()}
    if isinstance(node, list):
        return [_rewrite_refs(item) for item in node]
    return node


def build_openapi(app: FastAPI) -> dict[str, Any]:
    schema: dict[str, Any] = _rewrite_refs(
        get_openapi(title=app.title, version=app.version, routes=app.routes)
    )
    schemas: dict[str, Any] = schema.setdefault("components", {}).setdefault("schemas", {})
    for name in _FASTAPI_VALIDATION_SCHEMAS:
        schemas.pop(name, None)
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            response = operation.get("responses", {}).get("422")
            if response is not None:
                response["description"] = "Request validation failed."
    return schema


def install_openapi(app: FastAPI) -> None:
    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            app.openapi_schema = build_openapi(app)
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]
