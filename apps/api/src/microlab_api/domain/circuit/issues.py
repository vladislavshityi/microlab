"""Структурированные замечания к документу схемы."""

from dataclasses import dataclass, field
from enum import StrEnum


class Severity(StrEnum):
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


class IssueCode(StrEnum):
    """Стабильные машиночитаемые коды замечаний. UI опирается только на них."""

    INVALID_DOCUMENT = "INVALID_DOCUMENT"
    UNSUPPORTED_SCHEMA_VERSION = "UNSUPPORTED_SCHEMA_VERSION"
    DUPLICATE_COMPONENT_ID = "DUPLICATE_COMPONENT_ID"
    DUPLICATE_CONNECTION_ID = "DUPLICATE_CONNECTION_ID"
    UNKNOWN_COMPONENT_TYPE = "UNKNOWN_COMPONENT_TYPE"
    NOT_A_BOARD = "NOT_A_BOARD"
    BOARD_AS_COMPONENT = "BOARD_AS_COMPONENT"
    UNKNOWN_PROPERTY = "UNKNOWN_PROPERTY"
    INVALID_PROPERTY = "INVALID_PROPERTY"
    BROKEN_CONNECTION_REFERENCE = "BROKEN_CONNECTION_REFERENCE"
    UNKNOWN_PIN = "UNKNOWN_PIN"
    NON_ORTHOGONAL_ROUTE = "NON_ORTHOGONAL_ROUTE"


@dataclass(frozen=True, slots=True)
class Issue:
    """Замечание: код, серьёзность, сообщение (англ.) и ссылки на объекты документа.

    ``refs`` — идентификаторы объектов (``r1``, ``c1``) или выводов (``r1.1``), либо путь
    к полю документа для ошибок разбора.
    """

    code: IssueCode
    severity: Severity
    message: str
    refs: tuple[str, ...] = field(default=())


def has_errors(issues: list[Issue]) -> bool:
    return any(issue.severity is Severity.ERROR for issue in issues)
