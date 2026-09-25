"""Представление схемы для электрических правил: выводы, узлы и двухполюсные элементы."""

from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field

from microlab_api.circuit_schema.definitions import DefinitionRegistry
from microlab_api.circuit_schema.generated.circuit import CircuitDocument
from microlab_api.circuit_schema.generated.component_definition import (
    BoardElectricalLimits,
    ComponentDefinition,
    LedModel,
    NumberPropertyDefinition,
    PinDefinition,
    ResistorModel,
)
from microlab_api.domain.circuit.netlist import Net

# Типы выводов, которые всегда задают уровень узла.
_OUTPUT_TYPES = frozenset({"digital-output", "analog-output"})


@dataclass(frozen=True, slots=True)
class PinInfo:
    ref: str
    instance_id: str
    pin: PinDefinition
    is_board: bool

    @property
    def is_ground(self) -> bool:
        return self.pin.electrical_type == "ground"

    @property
    def is_supply(self) -> bool:
        """Выход питания (5V, 3.3V платы и т. п.)."""
        return self.pin.electrical_type == "power-output"

    @property
    def is_board_power_input(self) -> bool:
        """Вход питания платы (VIN): его напряжение зависит от способа питания платы."""
        return self.is_board and self.pin.electrical_type == "power-input"

    @property
    def is_gpio(self) -> bool:
        """Вывод общего назначения платы: может быть входом или выходом (зависит от кода)."""
        return (
            self.is_board
            and self.pin.electrical_type == "bidirectional"
            and "digital-io" in (self.pin.capabilities or [])
        )

    @property
    def is_driver(self) -> bool:
        """Вывод, который может задавать уровень узла: GPIO платы или выход компонента."""
        return self.is_gpio or self.pin.electrical_type in _OUTPUT_TYPES


@dataclass(frozen=True, slots=True)
class NetInfo:
    """Узел и его выводы без выводов гнёзд (отверстия макетной платы — просто проводник)."""

    net: Net
    pins: tuple[PinInfo, ...]

    @property
    def grounds(self) -> list[PinInfo]:
        return [p for p in self.pins if p.is_ground]

    @property
    def supplies(self) -> list[PinInfo]:
        return [p for p in self.pins if p.is_supply]

    @property
    def drivers(self) -> list[PinInfo]:
        return [p for p in self.pins if p.is_driver]

    @property
    def board_power_inputs(self) -> list[PinInfo]:
        return [p for p in self.pins if p.is_board_power_input]

    @property
    def is_ground(self) -> bool:
        return bool(self.grounds)

    @property
    def can_source(self) -> bool:
        """Узел может иметь положительное напряжение от источника."""
        return bool(self.supplies or self.drivers or self.board_power_inputs)

    @property
    def can_sink(self) -> bool:
        """Узел может принять ток к нулевому потенциалу."""
        return bool(self.grounds or self.drivers)


@dataclass(frozen=True, slots=True)
class Element:
    """Двухполюсный элемент схемы по его ``electricalModel``.

    ``terminals`` — ссылки на выводы; для светодиода это (анод, катод).
    ``value`` — сопротивление (Ом) для резистора, прямое напряжение (В) для светодиода.
    """

    instance_id: str
    kind: str
    terminals: tuple[str, str]
    value: float


@dataclass(slots=True)
class CircuitContext:
    board_id: str | None
    board_limits: BoardElectricalLimits | None
    pins: dict[str, PinInfo]
    nets: list[NetInfo]
    net_by_pin: dict[str, NetInfo]
    nets_by_id: dict[str, NetInfo]
    elements: list[Element]
    component_ids: list[str]
    """Компоненты (не плата и не гнёзда) в порядке документа."""
    adjacency: dict[str, list[tuple[Element, int]]] = field(default_factory=dict)

    def node(self, pin_ref: str) -> str:
        """Узел вывода: id net или отдельный узел для неподключённого вывода."""
        info = self.net_by_pin.get(pin_ref)
        return info.net.id if info is not None else f"~{pin_ref}"

    def net_info(self, node: str) -> NetInfo | None:
        return self.nets_by_id.get(node)

    def closure(self, start: str, kinds: Iterable[str]) -> set[str]:
        """Узлы, достижимые из ``start`` через элементы указанных видов."""
        allowed = frozenset(kinds)
        seen = {start}
        queue = deque([start])
        while queue:
            current = queue.popleft()
            for element, index in self.adjacency.get(current, []):
                if element.kind not in allowed:
                    continue
                other = self.node(element.terminals[1 - index])
                if other not in seen:
                    seen.add(other)
                    queue.append(other)
        return seen


def _number(definition: ComponentDefinition, properties: dict[str, object], prop_id: str) -> float:
    """Значение числового свойства; некорректное значение заменяется значением по умолчанию
    (о нём уже сообщает проверка свойств)."""
    prop = next(
        p
        for p in definition.properties
        if isinstance(p, NumberPropertyDefinition) and p.id == prop_id
    )
    value = properties.get(prop_id)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return prop.default
    if not prop.minimum <= value <= prop.maximum:
        return prop.default
    return float(value)


def build_context(
    document: CircuitDocument, registry: DefinitionRegistry, nets: list[Net]
) -> CircuitContext:
    pins: dict[str, PinInfo] = {}
    socket_pins: set[str] = set()
    elements: list[Element] = []
    component_ids: list[str] = []
    seen: set[str] = set()
    board_id: str | None = None
    board_limits: BoardElectricalLimits | None = None

    board_definition = registry.get(document.board.type)
    if board_definition is not None and board_definition.board is not None:
        board_id = document.board.id
        board_limits = board_definition.board.electrical_limits
        seen.add(board_id)
        for pin in board_definition.pins:
            ref = f"{board_id}.{pin.id}"
            pins[ref] = PinInfo(ref=ref, instance_id=board_id, pin=pin, is_board=True)

    for component in document.components:
        definition = registry.get(component.type)
        if definition is None or definition.category == "board" or component.id in seen:
            continue
        seen.add(component.id)
        for pin in definition.pins:
            ref = f"{component.id}.{pin.id}"
            pins[ref] = PinInfo(ref=ref, instance_id=component.id, pin=pin, is_board=False)
            if definition.socket:
                socket_pins.add(ref)
        if definition.socket:
            continue
        component_ids.append(component.id)
        model = definition.electrical_model
        properties: dict[str, object] = dict(component.properties)
        if isinstance(model, LedModel):
            elements.append(
                Element(
                    instance_id=component.id,
                    kind="led",
                    terminals=(f"{component.id}.{model.anode}", f"{component.id}.{model.cathode}"),
                    value=_number(definition, properties, model.forward_voltage_property),
                )
            )
        elif model is not None:
            a, b = (f"{component.id}.{pin.root}" for pin in model.terminals)
            value = (
                _number(definition, properties, model.resistance_property)
                if isinstance(model, ResistorModel)
                else 0.0
            )
            elements.append(
                Element(instance_id=component.id, kind=model.kind, terminals=(a, b), value=value)
            )

    infos = [
        NetInfo(
            net=net,
            pins=tuple(pins[m] for m in net.members if m in pins and m not in socket_pins),
        )
        for net in nets
    ]
    net_by_pin = {member: info for info in infos for member in info.net.members}
    context = CircuitContext(
        board_id=board_id,
        board_limits=board_limits,
        pins=pins,
        nets=infos,
        net_by_pin=net_by_pin,
        nets_by_id={info.net.id: info for info in infos},
        elements=elements,
        component_ids=component_ids,
    )
    for element in elements:
        for index, terminal in enumerate(element.terminals):
            context.adjacency.setdefault(context.node(terminal), []).append((element, index))
    return context
