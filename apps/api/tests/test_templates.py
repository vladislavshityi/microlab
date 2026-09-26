"""Шаблоны проектов из ``packages/circuit-schema/examples/templates``."""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.circuit_schema.paths import package_dir, schema_dir
from microlab_api.domain.circuit import Severity
from microlab_api.domain.validation import validate_circuit

TEMPLATE_FILES = sorted((package_dir() / "examples" / "templates").glob("*.json"))


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_template_set() -> None:
    templates = [_read(path) for path in TEMPLATE_FILES]
    ordered = [t["id"] for t in sorted(templates, key=lambda t: t["order"])]
    assert ordered == [
        "blink",
        "button",
        "pwm-led",
        "potentiometer",
        "servo-sweep",
        "seven-segment-counter",
    ]
    assert len({t["order"] for t in templates}) == len(templates)


@pytest.mark.parametrize("path", TEMPLATE_FILES, ids=lambda p: p.stem)
def test_template_is_valid(path: Path) -> None:
    template = _read(path)
    assert set(template) == {"id", "order", "name", "description", "code", "circuit"}
    assert template["id"] == path.stem
    for key in ("name", "description"):
        assert template[key]["key"] == f"templates.{path.stem}.{key}"
        assert template[key]["ru"]
    assert "void setup()" in template["code"]
    assert "void loop()" in template["code"]

    schema = _read(schema_dir() / "circuit.schema.json")
    Draft202012Validator(schema).validate(template["circuit"])
    issues = validate_circuit(template["circuit"], get_definition_registry()).issues
    # Шаблон — образцовая схема: без ошибок и предупреждений (INFO о шинах допустимы).
    assert [i for i in issues if i.severity != Severity.INFO] == []
