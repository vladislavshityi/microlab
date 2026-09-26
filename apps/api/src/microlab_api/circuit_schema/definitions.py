"""Загрузка определений компонентов из ``packages/circuit-schema/definitions``."""

import json
from collections.abc import Iterable, Mapping
from functools import lru_cache
from pathlib import Path

from microlab_api.circuit_schema.generated.component_definition import (
    ComponentDefinition,
    EnumPropertyDefinition,
    LedArrayModel,
    LedModel,
    NumberPropertyDefinition,
    PhotoresistorModel,
    PiezoModel,
    PotentiometerModel,
    ResistorModel,
    ServoModel,
    SwitchModel,
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
    problems.extend(_check_socket(definition))
    problems.extend(_check_electrical_model(definition))
    problems.extend(_check_board_limits(definition))

    property_ids = [prop.id for prop in definition.properties]
    if len(set(property_ids)) != len(property_ids):
        problems.append(f"{prefix}: duplicate property ids")
    for prop in definition.properties:
        problems.extend(_check_property(prefix, prop))
    return problems


def _check_socket(definition: ComponentDefinition) -> list[str]:
    if not definition.socket:
        return []
    if definition.category == "board":
        return [f"{definition.type}: a board cannot be a socket"]
    points = [(p.x, p.y) for p in definition.visual.pins.values()]
    if len(set(points)) != len(points):
        return [f"{definition.type}: socket pins must have distinct positions"]
    return []


def _check_board_limits(definition: ComponentDefinition) -> list[str]:
    if definition.board is None or definition.board.electrical_limits is None:
        return []
    mcu_pins = {pin.mcu_pin for pin in definition.pins if pin.mcu_pin is not None}
    problems: list[str] = []
    for limit in definition.board.electrical_limits.gpio_group_current_limits:
        unknown = sorted(p.root for p in limit.mcu_pins if p.root not in mcu_pins)
        if unknown:
            problems.append(f"{definition.type}: current limit group references unknown {unknown}")
    return problems


def _model_references(model: object) -> tuple[list[str], list[str], list[str]]:
    """Выводы, числовые и enum-свойства, на которые ссылается электрическая модель."""
    pins: list[str]
    props: list[str] = []
    enums: list[str] = []
    match model:
        case LedModel():
            pins, props = [model.anode, model.cathode], [model.forward_voltage_property]
        case ResistorModel():
            pins, props = [p.root for p in model.terminals], [model.resistance_property]
        case SwitchModel():
            pins = [p.root for p in model.terminals]
        case PotentiometerModel():
            pins = [*(p.root for p in model.terminals), model.wiper]
            props = [model.resistance_property, model.position_property]
        case PhotoresistorModel():
            pins = [p.root for p in model.terminals]
            props = [
                model.illuminance_property,
                model.resistance_at10_lux_property,
                model.gamma_property,
            ]
        case LedArrayModel():
            pins = [model.common, *(c.pin for c in model.channels)]
            props = sorted({c.forward_voltage_property for c in model.channels})
            enums = [model.polarity_property]
        case PiezoModel():
            pins = [model.positive, model.negative]
        case ServoModel():
            pins = [model.signal, model.power, model.ground]
            props = [model.min_pulse_property, model.max_pulse_property, model.min_supply_property]
        case _:
            raise TypeError(f"unknown electrical model {type(model).__name__}")
    return pins, props, enums


def _check_electrical_model(definition: ComponentDefinition) -> list[str]:
    model = definition.electrical_model
    if model is None:
        return []
    prefix = f"{definition.type}.electricalModel"
    pin_set = {pin.id for pin in definition.pins}
    number_props = {
        prop.id for prop in definition.properties if isinstance(prop, NumberPropertyDefinition)
    }
    enum_props = {
        prop.id: {option.value for option in prop.options}
        for prop in definition.properties
        if isinstance(prop, EnumPropertyDefinition)
    }
    pins, props, enums = _model_references(model)
    problems = [f"{prefix}: unknown pin {pin}" for pin in pins if pin not in pin_set]
    if len(set(pins)) != len(pins):
        problems.append(f"{prefix}: terminals must be distinct pins")
    problems += [
        f"{prefix}: {prop} is not a number property" for prop in props if prop not in number_props
    ]
    for prop in enums:
        if enum_props.get(prop) != {"common-cathode", "common-anode"}:
            problems.append(f"{prefix}: {prop} must be a common-cathode/common-anode enum property")
    if isinstance(model, LedArrayModel):
        channel_ids = [c.id for c in model.channels]
        if len(set(channel_ids)) != len(channel_ids):
            problems.append(f"{prefix}: duplicate channel ids")
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
