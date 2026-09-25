"""Модели API проверки схемы."""

from pydantic import Field

from microlab_api.domain.circuit import IssueCode, RefKind, Severity
from microlab_api.schemas.base import ApiModel


class IssueRef(ApiModel):
    kind: RefKind = Field(
        description="component: board or component id; connection: wire id; "
        "pin: componentId.pinId; net: netlist id; field: document field path."
    )
    id: str


class CircuitIssue(ApiModel):
    code: IssueCode
    severity: Severity
    message: str = Field(description="English text for logs and API clients; the UI uses code.")
    refs: list[IssueRef]
    params: dict[str, str | int | float] = Field(
        description="Values for the localized UI message, e.g. estimated current."
    )


class CircuitNet(ApiModel):
    id: str
    members: list[str] = Field(description="Pin references componentId.pinId.")


class CircuitValidationResponse(ApiModel):
    issues: list[CircuitIssue]
    nets: list[CircuitNet]
