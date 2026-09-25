import logging
from importlib.metadata import version
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from microlab_api.db.database import Database, get_database
from microlab_api.schemas.errors import ErrorResponse
from microlab_api.schemas.health import DatabaseCheck, HealthChecks, HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

_RESPONSES: dict[int | str, dict[str, Any]] = {
    200: {"model": HealthResponse, "description": "API and database are available."},
    503: {"model": HealthResponse, "description": "Database is unavailable."},
    500: {"model": ErrorResponse, "description": "Unexpected server error."},
}


@router.get(
    "/health",
    response_model=HealthResponse,
    responses=_RESPONSES,
    summary="Service health",
    operation_id="getHealth",
)
async def get_health(database: Annotated[Database, Depends(get_database)]) -> JSONResponse:
    try:
        await database.ping()
    except Exception as exc:
        # Никогда не логируем текст исключения: сообщения драйвера могут содержать
        # параметры подключения.
        logger.warning("database health check failed", extra={"error_type": type(exc).__name__})
        db_check = DatabaseCheck(status="error", code="DATABASE_UNAVAILABLE")
        status: Literal["ok", "unavailable"] = "unavailable"
        status_code = 503
    else:
        db_check = DatabaseCheck(status="ok")
        status = "ok"
        status_code = 200

    body = HealthResponse(
        status=status,
        version=version("microlab-api"),
        checks=HealthChecks(database=db_check),
    )
    return JSONResponse(
        status_code=status_code, content=body.model_dump(mode="json", exclude_none=True)
    )
