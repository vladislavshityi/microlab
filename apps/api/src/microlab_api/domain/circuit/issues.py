"""Структурированные замечания к документу схемы."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum


class Severity(StrEnum):
    """Issue severity: ERROR blocks compilation and simulation, WARNING and INFO do not."""

    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


# Docstring намеренно на английском: он попадает в OpenAPI и в сгенерированные типы frontend.
class IssueCode(StrEnum):
    """Stable machine-readable circuit issue codes. The UI relies only on these values."""

    # Структура документа и ссылки.
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
    # Электрические правила.
    POWER_SHORT_TO_GROUND = "POWER_SHORT_TO_GROUND"
    POWER_RAILS_SHORTED = "POWER_RAILS_SHORTED"
    VIN_CONNECTED_TO_RAIL = "VIN_CONNECTED_TO_RAIL"
    OUTPUT_TO_RAIL = "OUTPUT_TO_RAIL"
    OUTPUTS_CONNECTED = "OUTPUTS_CONNECTED"
    LED_WITHOUT_RESISTOR = "LED_WITHOUT_RESISTOR"
    LED_REVERSED = "LED_REVERSED"
    GPIO_CURRENT_EXCEEDS_LIMIT = "GPIO_CURRENT_EXCEEDS_LIMIT"
    GPIO_GROUP_CURRENT_EXCEEDS_LIMIT = "GPIO_GROUP_CURRENT_EXCEEDS_LIMIT"
    MISSING_GROUND = "MISSING_GROUND"
    FLOATING_POWER_PIN = "FLOATING_POWER_PIN"
    POWER_DOMAIN_MISMATCH = "POWER_DOMAIN_MISMATCH"
    SERIAL_PINS_USED = "SERIAL_PINS_USED"
    I2C_PINS_USED = "I2C_PINS_USED"
    SPI_PINS_USED = "SPI_PINS_USED"


class RefKind(StrEnum):
    """Kind of the object an issue refers to."""

    COMPONENT = "component"
    """Плата или компонент (id)."""
    CONNECTION = "connection"
    """Соединение (id провода)."""
    PIN = "pin"
    """Вывод ``componentId.pinId``."""
    NET = "net"
    """Узел netlist (``NET_001``)."""
    FIELD = "field"
    """Путь к полю документа (ошибки разбора и свойств)."""


@dataclass(frozen=True, slots=True)
class IssueRef:
    kind: RefKind
    id: str


def component_ref(item_id: str) -> IssueRef:
    return IssueRef(RefKind.COMPONENT, item_id)


def connection_ref(item_id: str) -> IssueRef:
    return IssueRef(RefKind.CONNECTION, item_id)


def pin_ref(ref: str) -> IssueRef:
    return IssueRef(RefKind.PIN, ref)


def net_ref(net_id: str) -> IssueRef:
    return IssueRef(RefKind.NET, net_id)


def field_ref(path: str) -> IssueRef:
    return IssueRef(RefKind.FIELD, path)


type IssueParam = str | int | float


@dataclass(frozen=True, slots=True)
class Issue:
    """Замечание: код, серьёзность, сообщение (англ.), ссылки на объекты и параметры.

    ``params`` — значения для локализованного сообщения UI (например, оценка тока).
    """

    code: IssueCode
    severity: Severity
    message: str
    refs: tuple[IssueRef, ...] = field(default=())
    params: Mapping[str, IssueParam] = field(default_factory=dict)


def has_errors(issues: list[Issue]) -> bool:
    return any(issue.severity is Severity.ERROR for issue in issues)
