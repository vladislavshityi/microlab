"""Определения компонентов и плат из пакета circuit-schema (только чтение)."""

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from microlab_api.api.errors import error_response
from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.circuit_schema.generated.component_definition import ComponentDefinition
from microlab_api.schemas.errors import ErrorCode, ErrorResponse

router = APIRouter(prefix="/components", tags=["components"])

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    500: {"model": ErrorResponse, "description": "Unexpected server error."},
}


@router.get(
    "",
    response_model=list[ComponentDefinition],
    response_model_exclude_none=True,
    responses=_ERROR_RESPONSES,
    summary="List component and board definitions",
    operation_id="listComponents",
)
async def list_components() -> list[ComponentDefinition]:
    return get_definition_registry().all()


@router.get(
    "/{component_type}",
    response_model=ComponentDefinition,
    response_model_exclude_none=True,
    responses={
        404: {"model": ErrorResponse, "description": "Unknown component type."},
        **_ERROR_RESPONSES,
    },
    summary="Get a component or board definition",
    operation_id="getComponent",
)
async def get_component(component_type: str) -> ComponentDefinition | JSONResponse:
    definition = get_definition_registry().get(component_type)
    if definition is None:
        return error_response(404, ErrorCode.UNKNOWN_COMPONENT_TYPE, "Unknown component type.")
    return definition
