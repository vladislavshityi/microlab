"""Проверка документа схемы без состояния.

Эндпоинт в контексте проекта (``POST /projects/{id}/validate``) использует ту же проверку
(:func:`build_validation_response`). Замечания к схеме — результат проверки, а не ошибка
запроса: ответ 200 даже для документа с ошибками.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Body

from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.domain.validation import validate_circuit
from microlab_api.schemas.errors import ErrorResponse
from microlab_api.schemas.validation import (
    CircuitIssue,
    CircuitNet,
    CircuitValidationResponse,
    IssueRef,
)

router = APIRouter(prefix="/circuits", tags=["circuits"])

_RESPONSES: dict[int | str, dict[str, Any]] = {
    422: {"model": ErrorResponse, "description": "Request body is not a JSON object."},
    500: {"model": ErrorResponse, "description": "Unexpected server error."},
}


@router.post(
    "/validate",
    response_model=CircuitValidationResponse,
    responses=_RESPONSES,
    summary="Validate a circuit document",
    operation_id="validateCircuit",
)
async def validate(
    document: Annotated[
        dict[str, Any], Body(description="Circuit document (CircuitDocument, schemaVersion 1).")
    ],
) -> CircuitValidationResponse:
    return build_validation_response(document)


def build_validation_response(document: object) -> CircuitValidationResponse:
    result = validate_circuit(document, get_definition_registry())
    return CircuitValidationResponse(
        issues=[
            CircuitIssue(
                code=issue.code,
                severity=issue.severity,
                message=issue.message,
                refs=[IssueRef(kind=ref.kind, id=ref.id) for ref in issue.refs],
                params=dict(issue.params),
            )
            for issue in result.issues
        ],
        nets=[CircuitNet(id=net.id, members=list(net.members)) for net in result.nets],
    )
