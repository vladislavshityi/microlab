"""Расположение пакета ``packages/circuit-schema`` в checkout монорепозитория."""

from pathlib import Path

from microlab_api.config import find_repo_root


class CircuitSchemaNotFoundError(RuntimeError):
    """Пакет circuit-schema не найден: backend запущен вне checkout репозитория."""


def package_dir() -> Path:
    root = find_repo_root()
    if root is None:
        raise CircuitSchemaNotFoundError("packages/circuit-schema: repository root not found")
    path = root / "packages" / "circuit-schema"
    if not path.is_dir():
        raise CircuitSchemaNotFoundError(f"{path} does not exist")
    return path


def schema_dir() -> Path:
    return package_dir() / "schema"


def definitions_dir() -> Path:
    return package_dir() / "definitions"
