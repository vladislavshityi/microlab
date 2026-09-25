"""Validation engine: электрические правила на небольших схемах."""

import json
from typing import Any

import pytest

from microlab_api.circuit_schema.definitions import (
    DefinitionRegistry,
    get_definition_registry,
)
from microlab_api.circuit_schema.generated.component_definition import ComponentDefinition
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.domain.circuit import Issue, IssueCode, Severity
from microlab_api.domain.circuit.issues import pin_ref
from microlab_api.domain.validation import validate_circuit

_counter = 0


def _component(component_type: str, **properties: Any) -> dict[str, Any]:
    """Компонент в отдельной позиции (без совпадений выводов)."""
    global _counter  # noqa: PLW0603 — счётчик только для уникальных позиций в тестах
    _counter += 1
    return {
        "id": f"{component_type.replace('-', '')}{_counter}",
        "type": component_type,
        "position": {"x": 20, "y": 4 * _counter},
        "rotation": 0,
        "properties": properties,
    }


def _circuit(components: list[dict[str, Any]], wires: list[tuple[str, str]]) -> dict[str, Any]:
    connections = []
    for index, (a, b) in enumerate(wires, start=1):
        (ca, pa), (cb, pb) = a.split("."), b.split(".")
        connections.append(
            {
                "id": f"w{index}",
                "from": {"componentId": ca, "pinId": pa},
                "to": {"componentId": cb, "pinId": pb},
            }
        )
    return {
        "schemaVersion": 1,
        "board": {"id": "uno1", "type": "arduino-uno-r3"},
        "components": components,
        "connections": connections,
    }


def _issues(raw: dict[str, Any], registry: DefinitionRegistry | None = None) -> list[Issue]:
    return validate_circuit(raw, registry or get_definition_registry()).issues


def _codes(raw: dict[str, Any]) -> list[IssueCode]:
    return [issue.code for issue in _issues(raw)]


def _led_chain(resistance: float | None, *, pin: str = "D13", vf: float = 2) -> dict[str, Any]:
    """pin → [R] → LED → GND."""
    led = _component("led", forwardVoltage=vf)
    components = [led]
    wires = [(f"{led['id']}.K", "uno1.GND1")]
    if resistance is None:
        wires.append((f"uno1.{pin}", f"{led['id']}.A"))
    else:
        resistor = _component("resistor", resistanceOhms=resistance)
        components.append(resistor)
        wires += [(f"uno1.{pin}", f"{resistor['id']}.1"), (f"{resistor['id']}.2", f"{led['id']}.A")]
    return _circuit(components, wires)


def test_external_led_reference_has_no_errors_or_warnings() -> None:
    raw = json.loads((package_dir() / "examples" / "external-led.json").read_text("utf-8"))
    issues = _issues(raw)
    assert [(i.code, i.severity) for i in issues] == [(IssueCode.SPI_PINS_USED, Severity.INFO)]


def test_breadboard_reference_has_no_errors_or_warnings() -> None:
    raw = json.loads((package_dir() / "examples" / "breadboard-led.json").read_text("utf-8"))
    assert _codes(raw) == [IssueCode.SPI_PINS_USED]


def test_led_without_resistor() -> None:
    issues = _issues(_led_chain(None))
    assert [i.code for i in issues] == [IssueCode.LED_WITHOUT_RESISTOR, IssueCode.SPI_PINS_USED]
    assert issues[0].severity is Severity.WARNING


def test_led_without_resistor_through_button_counts_as_pressed() -> None:
    led, button = _component("led"), _component("push-button")
    raw = _circuit(
        [led, button],
        [
            ("uno1.5V", f"{button['id']}.A"),
            (f"{button['id']}.B", f"{led['id']}.A"),
            (f"{led['id']}.K", "uno1.GND2"),
        ],
    )
    assert IssueCode.LED_WITHOUT_RESISTOR in _codes(raw)


def test_resistor_on_the_cathode_side_limits_current() -> None:
    led, resistor = _component("led"), _component("resistor", resistanceOhms=220)
    raw = _circuit(
        [led, resistor],
        [
            ("uno1.D13", f"{led['id']}.A"),
            (f"{led['id']}.K", f"{resistor['id']}.1"),
            (f"{resistor['id']}.2", "uno1.GND1"),
        ],
    )
    assert _codes(raw) == [IssueCode.SPI_PINS_USED]


def test_power_short_to_ground_is_error() -> None:
    issues = _issues(_circuit([], [("uno1.5V", "uno1.GND1")]))
    assert [(i.code, i.severity) for i in issues] == [
        (IssueCode.POWER_SHORT_TO_GROUND, Severity.ERROR)
    ]
    assert pin_ref("uno1.5V") in issues[0].refs


def test_power_short_through_breadboard_rail_is_error() -> None:
    raw = _circuit(
        [
            {
                "id": "bb1",
                "type": "breadboard",
                "position": {"x": 30, "y": 0},
                "rotation": 0,
                "properties": {},
            }
        ],
        [("uno1.5V", "bb1.tp1"), ("uno1.GND1", "bb1.tp25")],
    )
    assert _codes(raw) == [IssueCode.POWER_SHORT_TO_GROUND]


def test_5v_with_3v3_is_error() -> None:
    issues = _issues(_circuit([], [("uno1.5V", "uno1.3V3")]))
    assert [(i.code, i.severity) for i in issues] == [
        (IssueCode.POWER_RAILS_SHORTED, Severity.ERROR)
    ]
    assert issues[0].params["domains"] == "3V3, 5V"


def test_vin_to_ground_is_only_a_warning() -> None:
    issues = _issues(_circuit([], [("uno1.VIN", "uno1.GND1")]))
    assert [(i.code, i.severity) for i in issues] == [
        (IssueCode.VIN_CONNECTED_TO_RAIL, Severity.WARNING)
    ]


def test_gpio_directly_on_ground_and_gpio_to_gpio_are_warnings() -> None:
    assert _codes(_circuit([], [("uno1.D7", "uno1.GND1")])) == [IssueCode.OUTPUT_TO_RAIL]
    assert _codes(_circuit([], [("uno1.D7", "uno1.D8")])) == [IssueCode.OUTPUTS_CONNECTED]


@pytest.mark.parametrize(
    ("resistance", "vf", "expected_ma"),
    [(100, 2, 30.0), (100, 3, 20.0), (220, 2, None), (68, 2, 44.1)],
)
def test_gpio_current_estimate(resistance: float, vf: float, expected_ma: float | None) -> None:
    issues = [
        i
        for i in _issues(_led_chain(resistance, vf=vf))
        if i.code is IssueCode.GPIO_CURRENT_EXCEEDS_LIMIT
    ]
    if expected_ma is None or expected_ma <= 20:
        assert issues == []
    else:
        assert len(issues) == 1
        assert issues[0].params["currentMa"] == expected_ma
        assert issues[0].params["limitMa"] == 20
        assert issues[0].params["direction"] == "source"


def test_gpio_current_resistor_only_to_ground() -> None:
    resistor = _component("resistor", resistanceOhms=100)
    raw = _circuit(
        [resistor], [("uno1.D9", f"{resistor['id']}.1"), (f"{resistor['id']}.2", "uno1.GND1")]
    )
    issues = [i for i in _issues(raw) if i.code is IssueCode.GPIO_CURRENT_EXCEEDS_LIMIT]
    assert [i.params["currentMa"] for i in issues] == [50.0]


def test_gpio_sink_current_from_5v() -> None:
    led, resistor = _component("led"), _component("resistor", resistanceOhms=100)
    raw = _circuit(
        [led, resistor],
        [
            ("uno1.5V", f"{led['id']}.A"),
            (f"{led['id']}.K", f"{resistor['id']}.1"),
            (f"{resistor['id']}.2", "uno1.D4"),
        ],
    )
    issues = [i for i in _issues(raw) if i.code is IssueCode.GPIO_CURRENT_EXCEEDS_LIMIT]
    assert [(i.params["direction"], i.params["currentMa"]) for i in issues] == [("sink", 30.0)]


def test_branching_chain_is_not_estimated() -> None:
    raw = _led_chain(100)
    # Второй вывод в среднем узле: цепь больше не простая последовательная.
    resistor_id = raw["components"][1]["id"]
    raw["connections"].append(
        {
            "id": "w9",
            "from": {"componentId": resistor_id, "pinId": "2"},
            "to": {"componentId": "uno1", "pinId": "A0"},
        }
    )
    assert IssueCode.GPIO_CURRENT_EXCEEDS_LIMIT not in _codes(raw)


def test_gpio_group_current_limit() -> None:
    components: list[dict[str, Any]] = []
    wires: list[tuple[str, str]] = []
    # D5–D11: одна группа IOH (B0–B5, D5–D7) с пределом 150 mA; по 5 V / 220 Ω ≈ 22.7 mA.
    for pin in ("D5", "D6", "D7", "D8", "D9", "D10", "D11"):
        resistor = _component("resistor", resistanceOhms=220)
        components.append(resistor)
        wires += [(f"uno1.{pin}", f"{resistor['id']}.1"), (f"{resistor['id']}.2", "uno1.GND1")]
    issues = [
        i
        for i in _issues(_circuit(components, wires))
        if i.code is IssueCode.GPIO_GROUP_CURRENT_EXCEEDS_LIMIT
    ]
    assert len(issues) == 1
    assert issues[0].params["direction"] == "source"
    assert issues[0].params["limitMa"] == 150
    assert issues[0].params["currentMa"] == 159.1


def test_led_reversed() -> None:
    led, resistor = _component("led"), _component("resistor", resistanceOhms=220)
    raw = _circuit(
        [led, resistor],
        [
            ("uno1.D13", f"{resistor['id']}.1"),
            (f"{resistor['id']}.2", f"{led['id']}.K"),
            (f"{led['id']}.A", "uno1.GND1"),
        ],
    )
    assert _codes(raw) == [IssueCode.LED_REVERSED, IssueCode.SPI_PINS_USED]


def test_missing_ground() -> None:
    led, resistor = _component("led"), _component("resistor")
    raw = _circuit(
        [led, resistor],
        [("uno1.D13", f"{resistor['id']}.1"), (f"{resistor['id']}.2", f"{led['id']}.A")],
    )
    assert IssueCode.MISSING_GROUND in _codes(raw)


def test_button_reference_has_no_warnings() -> None:
    button = _component("push-button")
    raw = _circuit([button], [("uno1.D2", f"{button['id']}.A"), (f"{button['id']}.B", "uno1.GND1")])
    assert _codes(raw) == []


def test_bus_infos() -> None:
    button = _component("push-button")
    raw = _circuit([button], [("uno1.D0", f"{button['id']}.A"), (f"{button['id']}.B", "uno1.A4")])
    issues = _issues(raw)
    assert [(i.code, i.severity) for i in issues] == [
        (IssueCode.MISSING_GROUND, Severity.WARNING),
        (IssueCode.SERIAL_PINS_USED, Severity.INFO),
        (IssueCode.I2C_PINS_USED, Severity.INFO),
    ]
    assert issues[2].params["pins"] == "A4, SDA"


def _sensor_registry() -> DefinitionRegistry:
    sensor = ComponentDefinition.model_validate(
        {
            "type": "test-sensor",
            "displayName": {"key": "components.test-sensor.displayName", "ru": "Датчик"},
            "description": {"key": "components.test-sensor.description", "ru": "Тестовый датчик"},
            "category": "sensors",
            "pins": [
                {
                    "id": "VCC",
                    "name": "VCC",
                    "electricalType": "power-input",
                    "voltageDomain": "3V3",
                },
                {"id": "GND", "name": "GND", "electricalType": "ground"},
                {"id": "OUT", "name": "OUT", "electricalType": "digital-output"},
            ],
            "properties": [],
            "simulationAccuracy": "BEHAVIORAL",
            "limitations": [],
            "visual": {
                "width": 4,
                "height": 2,
                "pins": {"VCC": {"x": 0, "y": 1}, "GND": {"x": 4, "y": 1}, "OUT": {"x": 2, "y": 0}},
            },
        }
    )
    return DefinitionRegistry([*get_definition_registry().all(), sensor])


def test_floating_power_pins_and_domain_mismatch() -> None:
    registry = _sensor_registry()
    sensor = _component("test-sensor")
    floating = _issues(_circuit([sensor], [(f"{sensor['id']}.OUT", "uno1.D2")]), registry)
    # OUT — выход датчика на GPIO: выход с выходом (GPIO может быть выходом).
    assert [i.code for i in floating] == [
        IssueCode.OUTPUTS_CONNECTED,
        IssueCode.MISSING_GROUND,
        IssueCode.FLOATING_POWER_PIN,
        IssueCode.FLOATING_POWER_PIN,
    ]
    wired = _circuit(
        [sensor], [(f"{sensor['id']}.VCC", "uno1.5V"), (f"{sensor['id']}.GND", "uno1.GND1")]
    )
    assert [i.code for i in _issues(wired, registry)] == [IssueCode.POWER_DOMAIN_MISMATCH]


def test_output_pins_connected() -> None:
    registry = _sensor_registry()
    a, b = _component("test-sensor"), _component("test-sensor")
    raw = _circuit([a, b], [(f"{a['id']}.OUT", f"{b['id']}.OUT")])
    codes = [i.code for i in _issues(raw, registry)]
    assert IssueCode.OUTPUTS_CONNECTED in codes


def test_structural_errors_are_reported_with_electrical_rules() -> None:
    raw = _led_chain(None)
    raw["components"].append(
        {
            "id": "x1",
            "type": "flux-capacitor",
            "position": {"x": 0, "y": 40},
            "rotation": 0,
            "properties": {},
        }
    )
    codes = _codes(raw)
    assert codes[0] is IssueCode.UNKNOWN_COMPONENT_TYPE
    assert IssueCode.LED_WITHOUT_RESISTOR in codes


def test_unparsable_document_returns_only_parse_errors() -> None:
    result = validate_circuit({"schemaVersion": 2}, get_definition_registry())
    assert [i.code for i in result.issues] == [IssueCode.UNSUPPORTED_SCHEMA_VERSION]
    assert result.nets == []


def test_validation_is_deterministic() -> None:
    raw = _led_chain(100)
    first = validate_circuit(raw, get_definition_registry())
    second = validate_circuit(json.loads(json.dumps(raw)), get_definition_registry())
    assert first == second
