"""Разбор документа схемы из JSON-совместимых данных."""

from dataclasses import dataclass, field
from typing import Final

from pydantic import ValidationError

from microlab_api.circuit_schema.generated.circuit import CircuitDocument
from microlab_api.domain.circuit.issues import Issue, IssueCode, Severity

SUPPORTED_SCHEMA_VERSION: Final = 1


@dataclass(frozen=True, slots=True)
class ParseResult:
    """Документ (None, если разобрать не удалось) и замечания разбора."""

    document: CircuitDocument | None
    issues: list[Issue] = field(default_factory=list)


def parse_circuit(raw: object) -> ParseResult:
    """Проверяет версию формата и структуру документа по JSON Schema-модели."""
    if isinstance(raw, dict) and "schemaVersion" in raw:
        version = raw["schemaVersion"]
        # bool — подкласс int в Python, но true не является версией формата.
        if type(version) is not int or version != SUPPORTED_SCHEMA_VERSION:
            issue = Issue(
                code=IssueCode.UNSUPPORTED_SCHEMA_VERSION,
                severity=Severity.ERROR,
                message=(
                    f"Unsupported circuit schemaVersion {version!r}; "
                    f"supported: {SUPPORTED_SCHEMA_VERSION}."
                ),
                refs=("schemaVersion",),
            )
            return ParseResult(document=None, issues=[issue])

    try:
        document = CircuitDocument.model_validate(raw)
    except ValidationError as exc:
        issues = [
            Issue(
                code=IssueCode.INVALID_DOCUMENT,
                severity=Severity.ERROR,
                message=error["msg"],
                refs=(".".join(str(part) for part in error["loc"]),),
            )
            for error in exc.errors(include_url=False)
        ]
        return ParseResult(document=None, issues=issues)
    return ParseResult(document=document)
