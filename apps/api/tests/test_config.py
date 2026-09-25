import os
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from microlab_api import config
from microlab_api.schemas.base import ApiModel

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = API_DIR.parents[1]


@pytest.mark.parametrize("cwd", [REPO_ROOT, API_DIR, API_DIR / "tests"])
def test_env_files_are_found_from_any_project_directory(cwd: Path) -> None:
    previous = Path.cwd()
    os.chdir(cwd)
    try:
        assert config._env_files() == (REPO_ROOT / ".env", API_DIR / ".env")
    finally:
        os.chdir(previous)


def test_api_models_use_camel_case() -> None:
    class Sample(ApiModel):
        schema_version: int

    assert Sample(schema_version=1).model_dump() == {"schemaVersion": 1}
    assert Sample.model_validate({"schemaVersion": 2}).schema_version == 2


def test_environment_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MICROLAB_ENV", raising=False)

    with pytest.raises(ValidationError, match="env"):
        config.Settings(_env_file=None, database_url=SecretStr("postgresql+asyncpg://x/y"))
