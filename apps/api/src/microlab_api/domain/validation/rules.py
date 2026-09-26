"""Электрические правила проверки схемы.

Правила работают по netlist и определениям компонентов. Код скетча неизвестен, поэтому
режим GPIO (вход или выход, уровень) не известен: ERROR выдаётся только для того, что
неверно при любом коде (короткое замыкание выходов питания), остальное — WARNING/INFO.

Анализ цепей светодиодов и токов GPIO — топологический, без решения схемы:

* кнопки (``switch``) считаются замкнутыми — худший случай, «когда кнопка нажата»;
* «без резистора»: от анода до узла, который может быть источником (выход питания, GPIO,
  VIN), и от катода до узла, который может принять ток (GND, GPIO), есть путь только
  через провода и кнопки. Путь через другие светодиоды не рассматривается;
* «обратная полярность»: анод через провода и кнопки соединён с GND, а катод через
  провода, кнопки и резисторы — с узлом-источником. Такой светодиод не откроется ни при
  каком коде;
* оценка тока GPIO — только для простой последовательной цепи от вывода до GND
  (вывод отдаёт ток) или до выхода 5V (вывод принимает ток): I ≈ (U_io − ΣVf) / ΣR.
  Это оценка сверху: падение напряжения на выходе GPIO не учитывается. Разветвлённые
  цепи не оцениваются.
"""

from collections.abc import Iterator
from dataclasses import dataclass

from microlab_api.domain.circuit.issues import (
    Issue,
    IssueCode,
    IssueParam,
    IssueRef,
    Severity,
    component_ref,
    net_ref,
    pin_ref,
)
from microlab_api.domain.validation.context import CircuitContext, Element, NetInfo, PinInfo

_CONDUCTORS = ("switch",)
_SERIES = ("switch", "resistor")
_BUSES: tuple[tuple[IssueCode, frozenset[str], str], ...] = (
    (IssueCode.SERIAL_PINS_USED, frozenset({"uart-rx", "uart-tx"}), "UART (Serial)"),
    (IssueCode.I2C_PINS_USED, frozenset({"i2c-sda", "i2c-scl"}), "I2C (Wire)"),
    (IssueCode.SPI_PINS_USED, frozenset({"spi-ss", "spi-mosi", "spi-miso", "spi-sck"}), "SPI"),
)


def _issue(
    code: IssueCode,
    severity: Severity,
    message: str,
    refs: list[IssueRef],
    **params: IssueParam,
) -> Issue:
    return Issue(code=code, severity=severity, message=message, refs=tuple(refs), params=params)


def _pin_list(pins: list[PinInfo]) -> str:
    return ", ".join(p.ref for p in pins)


def check_electrical(ctx: CircuitContext) -> list[Issue]:
    """Все электрические правила в детерминированном порядке."""
    return [
        *_power_rules(ctx),
        *_led_rules(ctx),
        *_gpio_current_rules(ctx),
        *_connectivity_rules(ctx),
        *_bus_info(ctx),
    ]


def _power_rules(ctx: CircuitContext) -> Iterator[Issue]:
    for info in ctx.nets:
        grounds, supplies = info.grounds, info.supplies
        vins, drivers = info.board_power_inputs, info.drivers
        net = net_ref(info.net.id)
        if supplies and grounds:
            pins = supplies + grounds
            yield _issue(
                IssueCode.POWER_SHORT_TO_GROUND,
                Severity.ERROR,
                f"Power output shorted to ground: {_pin_list(pins)}.",
                [net, *(pin_ref(p.ref) for p in pins)],
                pins=_pin_list(pins),
            )
        domains = sorted({p.pin.voltage_domain for p in supplies if p.pin.voltage_domain})
        if len(domains) > 1:
            yield _issue(
                IssueCode.POWER_RAILS_SHORTED,
                Severity.ERROR,
                f"Power outputs of different voltages are connected: {_pin_list(supplies)}.",
                [net, *(pin_ref(p.ref) for p in supplies)],
                pins=_pin_list(supplies),
                domains=", ".join(domains),
            )
        if vins and (grounds or supplies):
            pins = vins + supplies + grounds
            yield _issue(
                IssueCode.VIN_CONNECTED_TO_RAIL,
                Severity.WARNING,
                f"VIN is connected to another power rail: {_pin_list(pins)}. "
                "Depending on how the board is powered this is a short circuit.",
                [net, *(pin_ref(p.ref) for p in pins)],
                pins=_pin_list(pins),
            )
        rails = supplies + grounds + vins
        if rails:
            for driver in drivers:
                yield _issue(
                    IssueCode.OUTPUT_TO_RAIL,
                    Severity.WARNING,
                    f"{driver.ref} is connected directly to {_pin_list(rails)}: "
                    "driving it as an output to the opposite level is a short circuit.",
                    [pin_ref(driver.ref), net, *(pin_ref(p.ref) for p in rails)],
                    pin=driver.ref,
                    rails=_pin_list(rails),
                )
        if len(drivers) > 1:
            yield _issue(
                IssueCode.OUTPUTS_CONNECTED,
                Severity.WARNING,
                f"Pins that can be outputs are connected directly: {_pin_list(drivers)}.",
                [net, *(pin_ref(p.ref) for p in drivers)],
                pins=_pin_list(drivers),
            )


def _any(ctx: CircuitContext, nodes: set[str], attribute: str) -> bool:
    infos = (ctx.net_info(node) for node in nodes)
    return any(info is not None and getattr(info, attribute) for info in infos)


def _led_rules(ctx: CircuitContext) -> Iterator[Issue]:
    for element in ctx.elements:
        if element.kind != "led":
            continue
        anode, cathode = element.terminals
        anode_side = ctx.closure(ctx.node(anode), _CONDUCTORS)
        cathode_side = ctx.closure(ctx.node(cathode), _CONDUCTORS)
        if anode_side & cathode_side:
            # Анод и катод замкнуты между собой: ток через светодиод не течёт.
            continue
        refs = [component_ref(element.instance_id), pin_ref(anode), pin_ref(cathode)]
        if _any(ctx, anode_side, "can_source") and _any(ctx, cathode_side, "can_sink"):
            yield _issue(
                IssueCode.LED_WITHOUT_RESISTOR,
                Severity.WARNING,
                f"LED {element.label} has no current-limiting resistor in its path.",
                refs,
                component=element.label,
            )
        cathode_series = ctx.closure(ctx.node(cathode), _SERIES)
        if _any(ctx, anode_side, "is_ground") and _any(ctx, cathode_series, "can_source"):
            yield _issue(
                IssueCode.LED_REVERSED,
                Severity.WARNING,
                f"LED {element.label} is reversed: the anode is on GND and the cathode "
                "goes to a source, so it can never be forward-biased.",
                refs,
                component=element.label,
            )


@dataclass(frozen=True, slots=True)
class _Chain:
    direction: str
    """``source`` — вывод отдаёт ток (цепь до GND), ``sink`` — принимает (цепь от 5V)."""
    current_ma: float
    components: tuple[str, ...]


@dataclass(slots=True)
class _Path:
    """Накопленные параметры последовательной цепи."""

    components: list[str]
    resistance: float = 0.0
    forward_voltage: float = 0.0
    source_ok: bool = True
    sink_ok: bool = True

    def add(self, element: Element, entry: int) -> None:
        self.components.append(element.instance_id)
        if element.kind == "resistor":
            self.resistance += element.value
        elif element.kind == "led":
            self.forward_voltage += element.value
            # Ток «от вывода» входит в светодиод через анод, «к выводу» — через катод.
            if entry == 0:
                self.sink_ok = False
            else:
                self.source_ok = False

    def chain(self, direction: str, io_voltage: float) -> _Chain | None:
        ok = self.source_ok if direction == "source" else self.sink_ok
        volts = io_voltage - self.forward_voltage
        if not ok or self.resistance <= 0 or volts <= 0:
            return None
        return _Chain(direction, volts / self.resistance * 1000, tuple(self.components))


def _walk(ctx: CircuitContext, first: Element, entry: int, terminals: set[str]) -> _Chain | None:
    """Идёт по простой последовательной цепи от вывода GPIO до GND или 5V."""
    if ctx.board_limits is None:
        return None
    path = _Path(components=[])
    element, index = first, entry
    for _ in range(len(ctx.elements)):
        if element.instance_id in path.components:
            break
        path.add(element, index)
        exit_terminal = element.terminals[1 - index]
        info = ctx.net_info(ctx.node(exit_terminal))
        if info is None:
            break
        direction = _terminal_direction(info)
        if direction is not None:
            return path.chain(direction, ctx.board_limits.io_voltage)
        attached = [
            (e, i) for e, i in ctx.adjacency.get(info.net.id, []) if e.terminals[i] != exit_terminal
        ]
        others = [p for p in info.pins if p.ref not in terminals]
        # Продолжаем только по простой цепи: в узле ровно один следующий элемент и больше ничего.
        if len(attached) != 1 or others:
            break
        element, index = attached[0]
    return None


def _terminal_direction(info: NetInfo) -> str | None:
    if info.grounds and not (info.supplies or info.drivers or info.board_power_inputs):
        return "source"
    supplies_5v = [p for p in info.supplies if p.pin.voltage_domain == "5V"]
    if (
        supplies_5v
        and len(supplies_5v) == len(info.supplies)
        and not (info.grounds or info.drivers or info.board_power_inputs)
    ):
        return "sink"
    return None


def _gpio_current_rules(ctx: CircuitContext) -> Iterator[Issue]:
    limits = ctx.board_limits
    if limits is None:
        return
    terminals = {terminal for element in ctx.elements for terminal in element.terminals}
    totals: dict[tuple[str, str], float] = {}
    for pin in ctx.pins.values():
        if not pin.is_gpio:
            continue
        info = ctx.net_by_pin.get(pin.ref)
        if info is None or len(info.drivers) > 1:
            continue
        if info.supplies or info.grounds or info.board_power_inputs:
            continue
        chains = [
            chain
            for element, index in ctx.adjacency.get(info.net.id, [])
            if (chain := _walk(ctx, element, index, terminals)) is not None
        ]
        for direction in ("source", "sink"):
            selected = [c for c in chains if c.direction == direction]
            if not selected:
                continue
            current = sum(c.current_ma for c in selected)
            totals[(pin.ref, direction)] = current
            if current > limits.gpio_pin_current_ma:
                components = [name for c in selected for name in c.components]
                yield _issue(
                    IssueCode.GPIO_CURRENT_EXCEEDS_LIMIT,
                    Severity.WARNING,
                    f"Estimated current of {pin.ref} ({direction}) is {current:.1f} mA, above the "
                    f"{limits.gpio_pin_current_ma:g} mA operating limit per pin.",
                    [pin_ref(pin.ref), *(component_ref(name) for name in components)],
                    pin=pin.ref,
                    direction=direction,
                    currentMa=round(current, 1),
                    limitMa=limits.gpio_pin_current_ma,
                )

    by_mcu_pin = {p.pin.mcu_pin: p for p in ctx.pins.values() if p.is_gpio and p.pin.mcu_pin}
    for group in limits.gpio_group_current_limits:
        members = [by_mcu_pin[m.root] for m in group.mcu_pins if m.root in by_mcu_pin]
        loaded = [p for p in members if (p.ref, group.direction) in totals]
        current = sum(totals[(p.ref, group.direction)] for p in loaded)
        if current > group.max_ma:
            yield _issue(
                IssueCode.GPIO_GROUP_CURRENT_EXCEEDS_LIMIT,
                Severity.WARNING,
                f"If {_pin_list(loaded)} are active at the same time, the estimated total "
                f"{group.direction} current {current:.1f} mA exceeds the {group.max_ma:g} mA "
                "limit for this pin group.",
                [pin_ref(p.ref) for p in loaded],
                pins=_pin_list(loaded),
                direction=group.direction,
                currentMa=round(current, 1),
                limitMa=group.max_ma,
            )


def _connectivity_rules(ctx: CircuitContext) -> Iterator[Issue]:
    board_id = ctx.board_id
    if board_id is not None:
        connected = grounded = False
        for info in ctx.nets:
            has_board = any(p.is_board for p in info.pins)
            has_component = any(not p.is_board for p in info.pins)
            if has_board and has_component:
                connected = True
                if any(p.is_board and p.is_ground for p in info.pins):
                    grounded = True
        if connected and not grounded:
            yield _issue(
                IssueCode.MISSING_GROUND,
                Severity.WARNING,
                "Components are connected to the board, but none is connected to GND.",
                [component_ref(board_id)],
            )

    for pin in ctx.pins.values():
        if pin.is_board or pin.instance_id not in ctx.component_ids:
            continue
        pin_net = ctx.net_by_pin.get(pin.ref)
        others = [p for p in pin_net.pins if p.ref != pin.ref] if pin_net is not None else []
        kind = pin.pin.electrical_type
        if kind == "power-input":
            supplies = [p for p in others if p.is_supply]
            if not supplies:
                yield _floating(pin)
                continue
            domain = pin.pin.voltage_domain
            wrong = [p for p in supplies if domain and p.pin.voltage_domain not in (None, domain)]
            if wrong:
                yield _issue(
                    IssueCode.POWER_DOMAIN_MISMATCH,
                    Severity.WARNING,
                    f"{pin.ref} expects {domain} but is powered from {_pin_list(wrong)}.",
                    [pin_ref(pin.ref), *(pin_ref(p.ref) for p in wrong)],
                    pin=pin.ref,
                    expected=domain or "",
                    supplies=_pin_list(wrong),
                )
        elif kind == "ground" and not any(p.is_board and p.is_ground for p in others):
            yield _floating(pin)


def _floating(pin: PinInfo) -> Issue:
    return _issue(
        IssueCode.FLOATING_POWER_PIN,
        Severity.WARNING,
        f"Power pin {pin.ref} is not connected to a power source.",
        [component_ref(pin.instance_id), pin_ref(pin.ref)],
        pin=pin.ref,
    )


def _bus_info(ctx: CircuitContext) -> Iterator[Issue]:
    used: list[PinInfo] = []
    for info in ctx.nets:
        if any(not p.is_board for p in info.pins):
            used.extend(p for p in info.pins if p.is_board)
    order = {ref: index for index, ref in enumerate(ctx.pins)}
    used.sort(key=lambda p: order[p.ref])
    for code, capabilities, bus in _BUSES:
        pins = [p for p in used if capabilities & set(p.pin.capabilities or [])]
        if pins:
            yield _issue(
                code,
                Severity.INFO,
                f"Pins shared with {bus} are used: {_pin_list(pins)}.",
                [pin_ref(p.ref) for p in pins],
                pins=", ".join(p.pin.name for p in pins),
            )
