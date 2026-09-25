"""Определение Arduino UNO R3 против сверенного pin mapping платы и ядра arduino:avr."""

from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.circuit_schema.generated.component_definition import (
    ComponentDefinition,
    PinDefinition,
)

# Эталон: Arduino-номер, порт ATmega328P. Совпадает с официальной распиновкой UNO R3,
# схемой платы и variants/standard/pins_arduino.h ядра arduino:avr 1.8.8.
EXPECTED_MAPPING = {
    "D0": (0, "PD0"),
    "D1": (1, "PD1"),
    "D2": (2, "PD2"),
    "D3": (3, "PD3"),
    "D4": (4, "PD4"),
    "D5": (5, "PD5"),
    "D6": (6, "PD6"),
    "D7": (7, "PD7"),
    "D8": (8, "PB0"),
    "D9": (9, "PB1"),
    "D10": (10, "PB2"),
    "D11": (11, "PB3"),
    "D12": (12, "PB4"),
    "D13": (13, "PB5"),
    "A0": (14, "PC0"),
    "A1": (15, "PC1"),
    "A2": (16, "PC2"),
    "A3": (17, "PC3"),
    "A4": (18, "PC4"),
    "A5": (19, "PC5"),
}


def _uno() -> ComponentDefinition:
    definition = get_definition_registry().get("arduino-uno-r3")
    assert definition is not None
    return definition


def _pins() -> dict[str, PinDefinition]:
    return {pin.id: pin for pin in _uno().pins}


def _with_capability(capability: str) -> set[str]:
    return {pin.id for pin in _uno().pins if capability in (pin.capabilities or [])}


def test_board_info() -> None:
    board = _uno().board
    assert board is not None
    assert (board.mcu, board.fqbn, board.clock_hz) == ("ATmega328P", "arduino:avr:uno", 16_000_000)


def test_pin_mapping() -> None:
    pins = _pins()
    mapped = {
        pin.id: (pin.arduino_pin, pin.mcu_pin)
        for pin in pins.values()
        if pin.arduino_pin is not None
    }
    assert mapped == EXPECTED_MAPPING
    assert pins["RESET"].mcu_pin == "PC6"


def test_pin_set() -> None:
    assert set(_pins()) == {
        *EXPECTED_MAPPING,
        *("SDA", "SCL", "AREF", "IOREF", "RESET", "3V3", "5V", "VIN", "GND1", "GND2", "GND3"),
    }


def test_capabilities() -> None:
    assert _with_capability("pwm") == {"D3", "D5", "D6", "D9", "D10", "D11"}
    assert _with_capability("adc") == {"A0", "A1", "A2", "A3", "A4", "A5"}
    assert _with_capability("digital-io") == set(EXPECTED_MAPPING)
    assert _with_capability("uart-rx") == {"D0"}
    assert _with_capability("uart-tx") == {"D1"}
    assert _with_capability("int0") == {"D2"}
    assert _with_capability("int1") == {"D3"}
    assert _with_capability("spi-ss") == {"D10"}
    assert _with_capability("spi-mosi") == {"D11"}
    assert _with_capability("spi-miso") == {"D12"}
    assert _with_capability("spi-sck") == {"D13"}
    assert _with_capability("i2c-sda") == {"A4", "SDA"}
    assert _with_capability("i2c-scl") == {"A5", "SCL"}
    assert _with_capability("builtin-led") == {"D13"}


def test_internal_connections() -> None:
    groups = {frozenset(group.root) for group in _uno().internal_connections or []}
    assert groups == {
        frozenset({"5V", "IOREF"}),
        frozenset({"A4", "SDA"}),
        frozenset({"A5", "SCL"}),
        frozenset({"GND1", "GND2", "GND3"}),
    }


def test_power_pins() -> None:
    pins = _pins()
    assert pins["5V"].electrical_type == "power-output"
    assert pins["3V3"].electrical_type == "power-output"
    assert pins["3V3"].voltage_domain == "3V3"
    assert pins["VIN"].electrical_type == "power-input"
    assert {pins[g].electrical_type for g in ("GND1", "GND2", "GND3")} == {"ground"}
