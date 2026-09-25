"""Проверка ссылок документа схемы на определения компонентов и друг на друга.

Электрические правила (короткие замыкания, нагрузка выводов и т. п.) сюда не входят.
"""

from collections import Counter
from itertools import pairwise

from microlab_api.circuit_schema.definitions import DefinitionRegistry
from microlab_api.circuit_schema.generated.circuit import (
    CircuitDocument,
    ComponentInstance,
    GridPoint,
    PinRef,
)
from microlab_api.circuit_schema.generated.component_definition import (
    ComponentDefinition,
    NumberPropertyDefinition,
)
from microlab_api.domain.circuit.issues import Issue, IssueCode, Severity


def _error(code: IssueCode, message: str, *refs: str) -> Issue:
    return Issue(code=code, severity=Severity.ERROR, message=message, refs=refs)


def instance_types(document: CircuitDocument) -> dict[str, str]:
    """Тип по id для платы и компонентов (при дубликатах побеждает первый)."""
    types: dict[str, str] = {}
    for instance_id, component_type in (
        (document.board.id, document.board.type),
        *((c.id, c.type) for c in document.components),
    ):
        types.setdefault(instance_id, component_type)
    return types


def check_references(document: CircuitDocument, registry: DefinitionRegistry) -> list[Issue]:
    """Возвращает замечания в детерминированном порядке обхода документа."""
    issues: list[Issue] = []

    ids = [document.board.id, *(c.id for c in document.components)]
    for instance_id, count in Counter(ids).items():
        if count > 1:
            issues.append(
                _error(
                    IssueCode.DUPLICATE_COMPONENT_ID,
                    f"Component id {instance_id!r} is used {count} times.",
                    instance_id,
                )
            )
    for connection_id, count in Counter(c.id for c in document.connections).items():
        if count > 1:
            issues.append(
                _error(
                    IssueCode.DUPLICATE_CONNECTION_ID,
                    f"Connection id {connection_id!r} is used {count} times.",
                    connection_id,
                )
            )

    board = registry.get(document.board.type)
    if board is None:
        issues.append(
            _error(
                IssueCode.UNKNOWN_COMPONENT_TYPE,
                f"Unknown board type {document.board.type!r}.",
                document.board.id,
            )
        )
    elif board.category != "board":
        issues.append(
            _error(
                IssueCode.NOT_A_BOARD,
                f"Type {board.type!r} is not a board.",
                document.board.id,
            )
        )

    for component in document.components:
        issues.extend(_check_component(component, registry))

    types = instance_types(document)
    for connection in document.connections:
        for end in (connection.from_, connection.to):
            issue = _check_pin_ref(connection.id, end, types, registry)
            if issue is not None:
                issues.append(issue)
        if connection.route and not _is_orthogonal(connection.route):
            issues.append(
                _error(
                    IssueCode.NON_ORTHOGONAL_ROUTE,
                    f"Connection {connection.id!r} has a diagonal route segment.",
                    connection.id,
                )
            )
    return issues


def _check_component(component: ComponentInstance, registry: DefinitionRegistry) -> list[Issue]:
    definition = registry.get(component.type)
    if definition is None:
        return [
            _error(
                IssueCode.UNKNOWN_COMPONENT_TYPE,
                f"Unknown component type {component.type!r}.",
                component.id,
            )
        ]
    if definition.category == "board":
        return [
            _error(
                IssueCode.BOARD_AS_COMPONENT,
                f"Board type {component.type!r} cannot be used as a component.",
                component.id,
            )
        ]
    return _check_properties(component, definition)


def _check_properties(component: ComponentInstance, definition: ComponentDefinition) -> list[Issue]:
    issues: list[Issue] = []
    known = {prop.id: prop for prop in definition.properties}
    for name, value in component.properties.items():
        ref = f"{component.id}.{name}"
        prop = known.get(name)
        if prop is None:
            issues.append(
                _error(
                    IssueCode.UNKNOWN_PROPERTY,
                    f"Component type {definition.type!r} has no property {name!r}.",
                    ref,
                )
            )
        elif isinstance(prop, NumberPropertyDefinition):
            if (
                isinstance(value, bool)
                or not isinstance(value, int | float)
                or not prop.minimum <= value <= prop.maximum
            ):
                issues.append(
                    _error(
                        IssueCode.INVALID_PROPERTY,
                        f"Property {name!r} must be a number in "
                        f"[{prop.minimum:g}, {prop.maximum:g}].",
                        ref,
                    )
                )
        elif value not in {option.value for option in prop.options}:
            issues.append(
                _error(
                    IssueCode.INVALID_PROPERTY,
                    f"Property {name!r} must be one of the defined options.",
                    ref,
                )
            )
    return issues


def _check_pin_ref(
    connection_id: str, end: PinRef, types: dict[str, str], registry: DefinitionRegistry
) -> Issue | None:
    pin_ref = f"{end.component_id}.{end.pin_id}"
    component_type = types.get(end.component_id)
    if component_type is None:
        return _error(
            IssueCode.BROKEN_CONNECTION_REFERENCE,
            f"Connection {connection_id!r} references missing component {end.component_id!r}.",
            connection_id,
            end.component_id,
        )
    definition = registry.get(component_type)
    if definition is None:
        # Неизвестный тип уже отмечен замечанием UNKNOWN_COMPONENT_TYPE.
        return None
    if all(pin.id != end.pin_id for pin in definition.pins):
        return _error(
            IssueCode.UNKNOWN_PIN,
            f"Component {end.component_id!r} ({component_type}) has no pin {end.pin_id!r}.",
            connection_id,
            pin_ref,
        )
    return None


def _is_orthogonal(route: list[GridPoint]) -> bool:
    return all(a.x == b.x or a.y == b.y for a, b in pairwise(route))
