"""Представление схемы для электрических правил: выводы, узлы и двухполюсные элементы."""

from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass, field

from microlab_api.circuit_schema.definitions import DefinitionRegistry
from microlab_api.circuit_schema.generated.circuit import CircuitDocument
from microlab_api.circuit_schema.generated.component_definition import (
    BoardElectricalLimits,
    ComponentDefinition,
    EnumPropertyDefinition,
    LedArrayModel,
    LedModel,
    NumberPropertyDefinition,
    PhotoresistorModel,
    PinDefinition,
    PotentiometerModel,
    ResistorModel,
    SwitchModel,
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
    Потенциометр даёт два резистора, фоторезистор — резистор, RGB-светодиод и
    7-сегментный индикатор — по светодиоду на канал (``channel``).
    """

    instance_id: str
    kind: str
    terminals: tuple[str, str]
    value: float
    channel: str | None = None

    @property
    def label(self) -> str:
        """Имя элемента в сообщениях: компонент или «компонент (канал)»."""
        return self.instance_id if self.channel is None else f"{self.instance_id} ({self.channel})"


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


# Наименьшее сопротивление части потенциометра — то же численное допущение, что в симуляторе.
_POT_MIN_SEGMENT_OHMS = 1.0


def _enum(definition: ComponentDefinition, properties: dict[str, object], prop_id: str) -> str:
    """Значение enum-свойства; некорректное значение заменяется значением по умолчанию."""
    prop = next(
        p
        for p in definition.properties
        if isinstance(p, EnumPropertyDefinition) and p.id == prop_id
    )
    value = properties.get(prop_id)
    if isinstance(value, str) and value in {o.value for o in prop.options}:
        return value
    return prop.default


def _elements(
    component_id: str, definition: ComponentDefinition, properties: dict[str, object]
) -> list[Element]:
    """Двухполюсные элементы компонента по его электрической модели.

    Пьезоизлучатель и сервопривод не образуют пути тока между выводами: элементов нет.
    """
    model = definition.electrical_model

    def ref(pin: str) -> str:
        return f"{component_id}.{pin}"

    def num(prop_id: str) -> float:
        return _number(definition, properties, prop_id)

    elements: list[Element] = []
    match model:
        case LedModel():
            terminals = (ref(model.anode), ref(model.cathode))
            elements.append(
                Element(component_id, "led", terminals, num(model.forward_voltage_property))
            )
        case ResistorModel():
            a, b = (ref(p.root) for p in model.terminals)
            elements.append(
                Element(component_id, "resistor", (a, b), num(model.resistance_property))
            )
        case SwitchModel():
            a, b = (ref(p.root) for p in model.terminals)
            elements.append(Element(component_id, "switch", (a, b), 0.0))
        case PotentiometerModel():
            total = num(model.resistance_property)
            position = num(model.position_property) / 100
            a, b = (ref(p.root) for p in model.terminals)
            wiper = ref(model.wiper)
            upper = max(total * position, _POT_MIN_SEGMENT_OHMS)
            lower = max(total * (1 - position), _POT_MIN_SEGMENT_OHMS)
            elements.append(Element(component_id, "resistor", (a, wiper), upper))
            elements.append(Element(component_id, "resistor", (wiper, b), lower))
        case PhotoresistorModel():
            lux = num(model.illuminance_property)
            resistance = num(model.resistance_at10_lux_property) * (lux / 10) ** -num(
                model.gamma_property
            )
            a, b = (ref(p.root) for p in model.terminals)
            elements.append(Element(component_id, "resistor", (a, b), resistance))
        case LedArrayModel():
            common_anode = _enum(definition, properties, model.polarity_property) == "common-anode"
            for channel in model.channels:
                pins = (ref(model.common), ref(channel.pin))
                terminals = pins if common_anode else (pins[1], pins[0])
                vf = num(channel.forward_voltage_property)
                elements.append(Element(component_id, "led", terminals, vf, channel.id))
        case _:
            pass
    return elements


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
        elements.extend(_elements(component.id, definition, dict(component.properties)))

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
