"""Детерминированно записывает документ OpenAPI в ``apps/api/openapi.json``.

Использование:
    uv run python -m microlab_api.scripts.export_openapi          # записать файл
    uv run python -m microlab_api.scripts.export_openapi --check  # exit 1, если устарел
"""

import argparse
import json
import sys
from pathlib import Path

from microlab_api.api.openapi import build_openapi
from microlab_api.app import create_app
from microlab_api.config import find_repo_root


def openapi_path() -> Path:
    root = find_repo_root()
    if root is None:
        raise SystemExit("export_openapi: run inside the MicroLab repository checkout")
    return root / "apps" / "api" / "openapi.json"


def render() -> str:
    return (
        json.dumps(build_openapi(create_app()), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument(
        "--check", action="store_true", help="do not write; exit 1 if the file is outdated"
    )
    args = parser.parse_args(argv)

    path = openapi_path()
    expected = render()
    if args.check:
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current != expected:
            print(
                f"{path} is outdated. Run: uv run python -m microlab_api.scripts.export_openapi",
                file=sys.stderr,
            )
            return 1
        print(f"{path} is up to date.")
        return 0

    path.write_text(expected, encoding="utf-8")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
