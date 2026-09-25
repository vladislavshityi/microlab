import json

import pytest
from fastapi import FastAPI

from microlab_api.api.openapi import build_openapi
from microlab_api.scripts import export_openapi


def test_committed_openapi_is_up_to_date(capsys: pytest.CaptureFixture[str]) -> None:
    assert export_openapi.main(["--check"]) == 0, capsys.readouterr().err


def test_openapi_documents_error_envelope_not_fastapi_validation_error() -> None:
    rendered = export_openapi.render()
    schema = json.loads(rendered)

    assert "HTTPValidationError" not in rendered
    assert "ValidationError" not in schema["components"]["schemas"]
    responses = schema["paths"]["/api/v1/health"]["get"]["responses"]
    assert responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/HealthResponse"
    )
    assert responses["503"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/HealthResponse"
    )
    assert responses["500"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ErrorResponse"
    )


def test_openapi_rewrites_validation_error_refs() -> None:
    app = FastAPI(title="t", version="0")

    @app.get("/items")
    async def items(limit: int) -> dict[str, int]:
        return {"limit": limit}

    rendered = json.dumps(build_openapi(app))
    assert "HTTPValidationError" not in rendered
    response_422 = build_openapi(app)["paths"]["/items"]["get"]["responses"]["422"]
    assert response_422["content"]["application/json"]["schema"]["$ref"] == (
        "#/components/schemas/ErrorResponse"
    )
