"""Загрузка определений компонентов из ``packages/circuit-schema/definitions``."""

import json
from collections.abc import Iterable, Mapping
from functools import lru_cache
from pathlib import Path

from microlab_api.circuit_schema.generated.component_definition import (
    ComponentDefinition,
    EnumPropertyDefinition,
    NumberPropertyDefinition,
)
from microlab_api.circuit_schema.paths import definitions_dir


class DefinitionRegistry:
    """Неизменяемый набор определений, индексированный по типу."""

    def __init__(self, definitions: Iterable[ComponentDefinition]) -> None:
        self._by_type: dict[str, ComponentDefinition] = {}
        for definition in definitions:
            if definition.type in self._by_type:
                raise ValueError(f"duplicate component definition type: {definition.type}")
            self._by_type[definition.type] = definition

    def get(self, component_type: str) -> ComponentDefinition | None:
        return self._by_type.get(component_type)

    def all(self) -> list[ComponentDefinition]:
        """Все определения в порядке имён файлов (тот же порядок, что в TypeScript)."""
        return list(self._by_type.values())

    @property
    def by_type(self) -> Mapping[str, ComponentDefinition]:
        return self._by_type


def load_definition(path: Path) -> ComponentDefinition:
    return ComponentDefinition.model_validate(json.loads(path.read_text(encoding="utf-8")))


def definition_files(directory: Path | None = None) -> list[Path]:
    return sorted((directory or definitions_dir()).glob("*.json"), key=lambda p: p.name)


@lru_cache(maxsize=1)
def get_definition_registry() -> DefinitionRegistry:
    """Реестр определений из пакета; загружается один раз за процесс."""
    registry = DefinitionRegistry(load_definition(path) for path in definition_files())
    problems = [problem for d in registry.all() for problem in check_definition(d)]
    if problems:
        raise ValueError("invalid component definitions: " + "; ".join(problems))
    return registry


def check_definition(definition: ComponentDefinition) -> list[str]:
    """Проверки согласованности, которые не выражаются в JSON Schema.

    Возвращает список найденных проблем (пустой — определение согласовано).
    """
    problems: list[str] = []
    prefix = definition.type
    pin_ids = [pin.id for pin in definition.pins]
    pin_set = set(pin_ids)

    if len(pin_set) != len(pin_ids):
        problems.append(f"{prefix}: duplicate pin ids")
    if set(definition.visual.pins) != pin_set:
        problems.append(f"{prefix}: visual.pins must list exactly the component pins")
    for pin_id, position in definition.visual.pins.items():
        inside_x = 0 <= position.x <= definition.visual.width
        inside_y = 0 <= position.y <= definition.visual.height
        if not (inside_x and inside_y):
            problems.append(f"{prefix}: pin {pin_id} is outside the symbol bounds")

    grouped: set[str] = set()
    for group in definition.internal_connections or []:
        for pin_id in group.root:
            if pin_id not in pin_set:
                problems.append(f"{prefix}: internal connection references unknown pin {pin_id}")
            if pin_id in grouped:
                problems.append(f"{prefix}: pin {pin_id} is in several internal connections")
            grouped.add(pin_id)

    if (definition.category == "board") != (definition.board is not None):
        problems.append(f"{prefix}: board info is required for boards and only for boards")

    property_ids = [prop.id for prop in definition.properties]
    if len(set(property_ids)) != len(property_ids):
        problems.append(f"{prefix}: duplicate property ids")
    for prop in definition.properties:
        problems.extend(_check_property(prefix, prop))
    return problems


def _check_property(
    prefix: str, prop: NumberPropertyDefinition | EnumPropertyDefinition
) -> list[str]:
    where = f"{prefix}.{prop.id}"
    if isinstance(prop, NumberPropertyDefinition):
        problems: list[str] = []
        if prop.minimum > prop.maximum:
            problems.append(f"{where}: minimum is greater than maximum")
        values = [prop.default, *(prop.presets or [])]
        if any(not prop.minimum <= value <= prop.maximum for value in values):
            problems.append(f"{where}: default or preset is out of range")
        return problems
    options = [option.value for option in prop.options]
    if len(set(options)) != len(options):
        return [f"{where}: duplicate enum options"]
    if prop.default not in options:
        return [f"{where}: default is not one of the options"]
    return []
