"""Макетная плата: топология, подключение по совпадению с отверстием и эталонные netlist."""

import json
from pathlib import Path
from typing import Any

import pytest

from microlab_api.circuit_schema.definitions import check_definition, get_definition_registry
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.domain.circuit import build_netlist, parse_circuit

# Макетная плата в (16, 0): столбец c → x = 17 + c; строки a–e → y = 4…8, f–j → y = 11…15;
# шины tp/tn → y = 1/2, bn/bp → y = 17/18.
BB = {"id": "bb1", "type": "breadboard", "position": {"x": 16, "y": 0}, "rotation": 0}


def _document(*components: dict[str, Any], connections: list[Any] | None = None) -> Any:
    return {
        "schemaVersion": 1,
        "board": {"id": "uno1", "type": "arduino-uno-r3"},
        "components": [{**BB, "properties": {}}, *components],
        "connections": connections or [],
    }


def _resistor(item_id: str, pin1: tuple[int, int], rotation: int = 0) -> dict[str, Any]:
    """Резистор, у которого вывод 1 находится в точке ``pin1`` (при повороте 0 или 90)."""
    x, y = pin1
    # Символ 4×2, вывод 1 в (0, 1); при повороте 90 — в (1, 0).
    position = {"x": x, "y": y - 1} if rotation == 0 else {"x": x - 1, "y": y}
    return {
        "id": item_id,
        "type": "resistor",
        "position": position,
        "rotation": rotation,
        "properties": {},
    }


def _nets(raw: Any) -> list[tuple[str, ...]]:
    result = parse_circuit(raw)
    assert result.document is not None, result.issues
    return [net.members for net in build_netlist(result.document, get_definition_registry())]


def _net_of(nets: list[tuple[str, ...]], pin: str) -> tuple[str, ...] | None:
    return next((net for net in nets if pin in net), None)


def _hole(column: int, row: str) -> tuple[int, int]:
    y = 4 + "abcde".index(row) if row in "abcde" else 11 + "fghij".index(row)
    return (17 + column, y)


def test_definition_topology() -> None:
    definition = get_definition_registry().get("breadboard")
    assert definition is not None
    assert definition.socket is True
    assert len(definition.pins) == 400
    groups = [set(group.root) for group in definition.internal_connections or []]
    assert len(groups) == 64
    assert {"a1", "b1", "c1", "d1", "e1"} in groups
    assert {"f30", "g30", "h30", "i30", "j30"} in groups
    for rail in ("tp", "tn", "bn", "bp"):
        assert {f"{rail}{i}" for i in range(1, 26)} in groups
    # Шаг 2,54 мм: соседние отверстия — соседние узлы сетки; канавка — 3 шага между e и f.
    pins = definition.visual.pins
    assert (pins["a2"].x - pins["a1"].x, pins["b1"].y - pins["a1"].y) == (1, 1)
    assert pins["f1"].y - pins["e1"].y == 3


def test_same_column_a_to_e_is_one_net() -> None:
    nets = _nets(_document(_resistor("r1", _hole(5, "a")), _resistor("r2", _hole(5, "e"))))
    net = _net_of(nets, "r1.1")
    assert net is not None
    assert "r2.1" in net
    assert {f"bb1.{row}5" for row in "abcde"} <= set(net)


def test_trench_separates_e_and_f() -> None:
    nets = _nets(_document(_resistor("r1", _hole(5, "e")), _resistor("r2", _hole(5, "f"))))
    assert _net_of(nets, "r1.1") != _net_of(nets, "r2.1")
    assert _net_of(nets, "r2.1") is not None


def test_neighbour_columns_are_separate() -> None:
    nets = _nets(_document(_resistor("r1", _hole(5, "a")), _resistor("r2", _hole(6, "a"))))
    assert _net_of(nets, "r1.1") != _net_of(nets, "r2.1")


def test_rail_strip_is_continuous_and_rails_are_separate() -> None:
    # tp1 в x = 19, tp25 в x = 47 (группы по 5 с промежутком); tn — на строку ниже.
    tp1, tp25, tn25 = (19, 1), (47, 1), (47, 2)
    nets = _nets(
        _document(
            _resistor("r1", tp1, rotation=90),
            _resistor("r2", tp25, rotation=90),
            _resistor("r3", tn25, rotation=90),
        )
    )
    net = _net_of(nets, "r1.1")
    assert net is not None
    assert "r2.1" in net
    assert "r3.1" not in net


def test_proximity_is_not_a_connection() -> None:
    # Между строками e (y = 8) и f (y = 11) отверстий нет.
    nets = _nets(_document(_resistor("r1", (22, 9))))
    assert _net_of(nets, "r1.1") is None


def test_board_pins_do_not_plug_into_holes() -> None:
    # Отверстие a1 макетной платы совпадает с выводом D13 платы (12, 6), но это не соединение.
    raw = _document()
    raw["components"][0]["position"] = {"x": 10, "y": 2}
    assert all("uno1.D13" not in net for net in _nets(raw))


def test_empty_strips_are_not_reported() -> None:
    assert all(not all(m.startswith("bb1.") for m in net) for net in _nets(_document()))


def test_rotated_breadboard_uses_rotated_holes() -> None:
    # Поворот 90: локальная точка (x, y) → (19 - y, x); a1 (2, 4) → (15, 2) + (16, 0) = (31, 2).
    raw = _document(_resistor("r1", (31, 2)))
    raw["components"][0]["rotation"] = 90
    net = _net_of(_nets(raw), "r1.1")
    assert net is not None
    assert "bb1.a1" in net


def _golden_cases() -> list[Path]:
    return sorted((package_dir() / "examples" / "netlists").glob("*.json"))


@pytest.mark.parametrize("expected_path", _golden_cases(), ids=lambda p: p.stem)
def test_golden_netlists(expected_path: Path) -> None:
    # Те же файлы проверяет frontend: netlist одинаков в обоих языках.
    example = package_dir() / "examples" / expected_path.name
    raw = json.loads(example.read_text(encoding="utf-8"))
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    result = parse_circuit(raw)
    assert result.document is not None
    nets = build_netlist(result.document, get_definition_registry())
    assert [{"id": n.id, "members": list(n.members)} for n in nets] == expected


def test_golden_cases_exist() -> None:
    assert {p.name for p in _golden_cases()} == {"breadboard-led.json", "external-led.json"}


def test_definition_checks_for_sockets_and_electrical_models() -> None:
    registry = get_definition_registry()
    breadboard = registry.get("breadboard")
    led = registry.get("led")
    assert breadboard is not None
    assert led is not None
    pins = dict(breadboard.visual.pins)
    pins["a2"] = pins["a1"]
    broken_socket = breadboard.model_copy(
        update={"visual": breadboard.visual.model_copy(update={"pins": pins})}
    )
    assert "breadboard: socket pins must have distinct positions" in check_definition(broken_socket)
    assert led.electrical_model is not None
    broken_led = led.model_copy(
        update={"electrical_model": led.electrical_model.model_copy(update={"anode": "X"})}
    )
    assert check_definition(broken_led) == ["led.electricalModel: unknown pin X"]
