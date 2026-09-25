"""Circuit Model: разбор документа, проверка ссылок и netlist."""

import copy
import json
from typing import Any

import pytest

from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.circuit_schema.generated.circuit import CircuitDocument
from microlab_api.circuit_schema.paths import package_dir
from microlab_api.domain.circuit import (
    IssueCode,
    Severity,
    build_netlist,
    check_references,
    has_errors,
    parse_circuit,
)
from microlab_api.domain.circuit.issues import component_ref, connection_ref, field_ref, pin_ref


@pytest.fixture
def external_led() -> dict[str, Any]:
    path = package_dir() / "examples" / "external-led.json"
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def _parse(raw: object) -> CircuitDocument:
    result = parse_circuit(raw)
    assert result.issues == []
    assert result.document is not None
    return result.document


def _codes(raw: dict[str, Any]) -> list[IssueCode]:
    return [issue.code for issue in check_references(_parse(raw), get_definition_registry())]


def test_parse_valid_document(external_led: dict[str, Any]) -> None:
    document = _parse(external_led)
    assert document.schema_version == 1
    assert document.connections[0].from_.pin_id == "D13"


def test_round_trip_keeps_camel_case(external_led: dict[str, Any]) -> None:
    dumped = _parse(external_led).model_dump(mode="json", by_alias=True, exclude_none=True)
    assert dumped["schemaVersion"] == 1
    assert dumped["connections"][0]["from"] == {"componentId": "uno1", "pinId": "D13"}


@pytest.mark.parametrize("version", [0, 2, "1", True, None])
def test_unsupported_schema_version(external_led: dict[str, Any], version: object) -> None:
    external_led["schemaVersion"] = version
    result = parse_circuit(external_led)
    assert result.document is None
    assert [issue.code for issue in result.issues] == [IssueCode.UNSUPPORTED_SCHEMA_VERSION]


def test_invalid_document_reports_field_paths(external_led: dict[str, Any]) -> None:
    del external_led["board"]
    external_led["components"][0]["rotation"] = 45
    result = parse_circuit(external_led)
    assert result.document is None
    assert {issue.code for issue in result.issues} == {IssueCode.INVALID_DOCUMENT}
    refs = {issue.refs[0] for issue in result.issues}
    assert field_ref("board") in refs
    assert field_ref("components.0.rotation") in refs


def test_valid_document_has_no_reference_issues(external_led: dict[str, Any]) -> None:
    assert _codes(external_led) == []


def test_duplicate_ids(external_led: dict[str, Any]) -> None:
    external_led["components"][1]["id"] = "uno1"
    external_led["connections"][1]["id"] = "w1"
    issues = check_references(_parse(external_led), get_definition_registry())
    assert [(i.code, i.refs) for i in issues] == [
        (IssueCode.DUPLICATE_COMPONENT_ID, (component_ref("uno1"),)),
        (IssueCode.DUPLICATE_CONNECTION_ID, (connection_ref("w1"),)),
        # led1 переименован: соединения (второе теперь тоже w1) ссылаются на исчезнувший компонент.
        (IssueCode.BROKEN_CONNECTION_REFERENCE, (connection_ref("w1"), component_ref("led1"))),
        (IssueCode.BROKEN_CONNECTION_REFERENCE, (connection_ref("w3"), component_ref("led1"))),
    ]
    assert all(issue.severity is Severity.ERROR for issue in issues)


def test_unknown_types_and_board_misuse(external_led: dict[str, Any]) -> None:
    external_led["board"]["type"] = "resistor"
    external_led["components"][0]["type"] = "arduino-uno-r3"
    external_led["components"][1]["type"] = "flux-capacitor"
    codes = _codes(external_led)
    assert codes[:3] == [
        IssueCode.NOT_A_BOARD,
        IssueCode.BOARD_AS_COMPONENT,
        IssueCode.UNKNOWN_COMPONENT_TYPE,
    ]


def test_unknown_pin(external_led: dict[str, Any]) -> None:
    external_led["connections"][0]["from"]["pinId"] = "D14"
    issues = check_references(_parse(external_led), get_definition_registry())
    assert [(i.code, i.refs) for i in issues] == [
        (IssueCode.UNKNOWN_PIN, (connection_ref("w1"), pin_ref("uno1.D14")))
    ]


@pytest.mark.parametrize(
    ("name", "value", "code"),
    [
        ("resistanceOhms", 0, IssueCode.INVALID_PROPERTY),
        ("resistanceOhms", "220", IssueCode.INVALID_PROPERTY),
        ("resistanceOhms", True, IssueCode.INVALID_PROPERTY),
        ("power", 1, IssueCode.UNKNOWN_PROPERTY),
    ],
)
def test_invalid_properties(
    external_led: dict[str, Any], name: str, value: object, code: IssueCode
) -> None:
    external_led["components"][0]["properties"] = {name: value}
    assert _codes(external_led) == [code]


def test_enum_property(external_led: dict[str, Any]) -> None:
    external_led["components"][1]["properties"]["color"] = "ultraviolet"
    assert _codes(external_led) == [IssueCode.INVALID_PROPERTY]


def test_diagonal_route(external_led: dict[str, Any]) -> None:
    external_led["connections"][0]["route"] = [{"x": 0, "y": 0}, {"x": 1, "y": 1}]
    assert _codes(external_led) == [IssueCode.NON_ORTHOGONAL_ROUTE]


def test_has_errors(external_led: dict[str, Any]) -> None:
    assert not has_errors(check_references(_parse(external_led), get_definition_registry()))
    external_led["connections"][0]["to"]["componentId"] = "r9"
    assert has_errors(check_references(_parse(external_led), get_definition_registry()))


def _nets(raw: dict[str, Any]) -> dict[str, tuple[str, ...]]:
    netlist = build_netlist(_parse(raw), get_definition_registry())
    return {net.id: net.members for net in netlist}


def test_external_led_netlist(external_led: dict[str, Any]) -> None:
    assert _nets(external_led) == {
        "NET_001": ("uno1.D13", "resistor1.1"),
        "NET_002": ("uno1.A4", "uno1.SDA"),
        "NET_003": ("uno1.A5", "uno1.SCL"),
        "NET_004": ("uno1.IOREF", "uno1.5V"),
        "NET_005": ("uno1.GND1", "uno1.GND2", "uno1.GND3", "led1.K"),
        "NET_006": ("resistor1.2", "led1.A"),
    }


def test_netlist_does_not_depend_on_connection_order(external_led: dict[str, Any]) -> None:
    shuffled = copy.deepcopy(external_led)
    shuffled["connections"].reverse()
    for connection in shuffled["connections"]:
        connection["from"], connection["to"] = connection["to"], connection["from"]
    assert _nets(shuffled) == _nets(external_led)


def test_netlist_merges_nets_through_internal_connections(external_led: dict[str, Any]) -> None:
    # Катод на GND1, а второй провод — на GND2: это один узел через внутреннюю связь платы.
    external_led["connections"][2]["to"]["pinId"] = "GND1"
    external_led["connections"].append(
        {
            "id": "w4",
            "from": {"componentId": "resistor1", "pinId": "1"},
            "to": {"componentId": "uno1", "pinId": "GND2"},
        }
    )
    nets = _nets(external_led)
    assert ("uno1.D13", "uno1.GND1", "uno1.GND2", "uno1.GND3", "resistor1.1", "led1.K") in (
        nets.values()
    )


def test_netlist_skips_broken_references(external_led: dict[str, Any]) -> None:
    external_led["connections"][0]["to"]["componentId"] = "missing"
    nets = _nets(external_led)
    assert all("uno1.D13" not in members for members in nets.values())
