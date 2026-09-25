"""Генерирует Pydantic-модели из JSON Schema пакета ``packages/circuit-schema``.

Использование:
    uv run python -m microlab_api.scripts.gen_circuit_schema          # записать файлы
    uv run python -m microlab_api.scripts.gen_circuit_schema --check  # exit 1, если устарели

Требует dev-зависимость ``datamodel-code-generator``.
"""

import argparse
import sys
from pathlib import Path

from microlab_api.circuit_schema.paths import schema_dir
from microlab_api.config import find_repo_root

HEADER = "# Сгенерировано из packages/circuit-schema. Не редактировать вручную."  # noqa: RUF001

# Файл схемы -> модуль в пакете microlab_api.circuit_schema.generated.
SCHEMAS: dict[str, str] = {
    "circuit.schema.json": "circuit.py",
    "component-definition.schema.json": "component_definition.py",
}


def _api_dir() -> Path:
    # Пути берутся от корня checkout, а не от __file__: при non-editable установке модуль
    # лежит в site-packages.
    root = find_repo_root()
    if root is None:
        raise SystemExit("gen_circuit_schema: run inside the MicroLab repository checkout")
    return root / "apps" / "api"


def output_dir() -> Path:
    return _api_dir() / "src" / "microlab_api" / "circuit_schema" / "generated"


def _pyproject() -> Path:
    return _api_dir() / "pyproject.toml"


def render(schema_file: Path) -> str:
    # Импорт внутри функции: генератор — dev-зависимость и не нужен приложению во время работы.
    from datamodel_code_generator import (  # noqa: PLC0415
        InputFileType,
        LiteralType,
        PythonVersion,
        generate,
    )
    from datamodel_code_generator.enums import DataModelType  # noqa: PLC0415
    from datamodel_code_generator.format import Formatter  # noqa: PLC0415

    result = generate(
        schema_file,
        input_file_type=InputFileType.JsonSchema,
        output_model_type=DataModelType.PydanticV2BaseModel,
        target_python_version=PythonVersion.PY_313,
        snake_case_field=True,
        allow_population_by_field_name=True,
        use_annotated=True,
        field_constraints=True,
        use_standard_collections=True,
        use_union_operator=True,
        collapse_root_models=True,
        use_title_as_name=True,
        use_schema_description=True,
        use_field_description=True,
        enum_field_as_literal=LiteralType.All,
        use_double_quotes=True,
        disable_timestamp=True,
        custom_file_header=HEADER,
        formatters=[Formatter.RUFF_FORMAT, Formatter.RUFF_CHECK],
        settings_path=_pyproject(),
    )
    if not isinstance(result, str):
        raise TypeError(f"unexpected generator output for {schema_file.name}")
    # Как у ruff format: файл заканчивается ровно одним переводом строки.
    return result.rstrip("\n") + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument(
        "--check", action="store_true", help="do not write; exit 1 if the files are outdated"
    )
    args = parser.parse_args(argv)

    outdated = False
    for schema_name, module_name in SCHEMAS.items():
        path = output_dir() / module_name
        expected = render(schema_dir() / schema_name)
        if args.check:
            current = path.read_text(encoding="utf-8") if path.exists() else None
            if current != expected:
                print(f"{path} is outdated.", file=sys.stderr)
                outdated = True
        else:
            path.write_text(expected, encoding="utf-8")
            print(f"wrote {path}")

    if outdated:
        print(
            "Run: uv run python -m microlab_api.scripts.gen_circuit_schema",
            file=sys.stderr,
        )
        return 1
    if args.check:
        print("Generated circuit-schema models are up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
