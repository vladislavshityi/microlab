"""Пакет circuit-schema: JSON Schema, определения компонентов и сгенерированные модели."""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from microlab_api.circuit_schema.definitions import (
    check_definition,
    definition_files,
    get_definition_registry,
    load_definition,
)
from microlab_api.circuit_schema.paths import package_dir, schema_dir
from microlab_api.scripts import gen_circuit_schema

DEFINITION_FILES = definition_files()
EXAMPLE_FILES = sorted((package_dir() / "examples").glob("*.json"))


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validator(name: str) -> Draft202012Validator:
    schema = _read(schema_dir() / name)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def test_definitions_exist() -> None:
    assert [path.name for path in DEFINITION_FILES] == [
        "arduino-uno-r3.json",
        "breadboard.json",
        "led.json",
        "photoresistor.json",
        "piezo-buzzer.json",
        "potentiometer.json",
        "push-button.json",
        "resistor.json",
        "rgb-led.json",
        "servo.json",
        "seven-segment.json",
    ]


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_definition_matches_json_schema(path: Path) -> None:
    errors = list(_validator("component-definition.schema.json").iter_errors(_read(path)))
    assert errors == []


@pytest.mark.parametrize("path", DEFINITION_FILES, ids=lambda p: p.name)
def test_definition_is_consistent(path: Path) -> None:
    definition = load_definition(path)
    assert definition.type == path.stem
    assert check_definition(definition) == []


@pytest.mark.parametrize("path", EXAMPLE_FILES, ids=lambda p: p.name)
def test_example_circuit_matches_json_schema(path: Path) -> None:
    errors = list(_validator("circuit.schema.json").iter_errors(_read(path)))
    assert errors == []


def test_circuit_schema_requires_integer_grid_and_version() -> None:
    validator = _validator("circuit.schema.json")
    document = _read(EXAMPLE_FILES[0])
    document["components"][0]["position"]["x"] = 1.5
    document["schemaVersion"] = 2
    messages = sorted(error.validator for error in validator.iter_errors(document))
    assert messages == ["const", "type"]


def test_registry_loads_all_definitions() -> None:
    registry = get_definition_registry()
    assert sorted(registry.by_type) == [
        "arduino-uno-r3",
        "breadboard",
        "led",
        "photoresistor",
        "piezo-buzzer",
        "potentiometer",
        "push-button",
        "resistor",
        "rgb-led",
        "servo",
        "seven-segment",
    ]
    assert registry.get("capacitor") is None


def test_generated_models_are_up_to_date(capsys: pytest.CaptureFixture[str]) -> None:
    assert gen_circuit_schema.main(["--check"]) == 0, capsys.readouterr().err
