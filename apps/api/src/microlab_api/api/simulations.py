"""Симуляция проекта: запуск, управление и поток событий.

Запуск (``POST /projects/{id}/simulation/start``) выполняет весь цикл над сохранённым
проектом: проверка схемы (ERROR → 422 CIRCUIT_HAS_ERRORS, компиляция не выполняется) →
компиляция (ошибка → 422 COMPILATION_FAILED, симуляция не запускается) → новая сессия в
сервисе симуляции (предыдущая сессия проекта останавливается). Предупреждения схемы запуску
не мешают и возвращаются в ответе.

События передаются по WebSocket ``/api/v1/ws/projects/{id}/simulation``: путь находится под
тем же префиксом ``/api/v1``, что и REST, поэтому dev-прокси и обратный прокси обслуживают
API одним правилом. Подписчиков может быть несколько (например, две вкладки); сессия
продолжается без подписчиков до таймаута простоя или остановки.
"""

import asyncio
import contextlib
import logging
import uuid
from typing import Annotated, Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request, WebSocket
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from microlab_api.api.circuits import validation_response
from microlab_api.api.compilation import COMPILE_RESPONSES, compile_response, get_compiler
from microlab_api.api.current_user import CurrentUser, resolve_user
from microlab_api.api.errors import DATABASE_UNAVAILABLE_ERRORS, ApiError, error_response
from microlab_api.circuit_schema.definitions import get_definition_registry
from microlab_api.db.database import Database, get_session
from microlab_api.domain.circuit import Severity, parse_circuit
from microlab_api.domain.simulation.circuit_payload import build_circuit_payload
from microlab_api.domain.validation import validate_circuit
from microlab_api.schemas.errors import ErrorBody, ErrorCode, ErrorDetail, ErrorResponse
from microlab_api.schemas.simulation import (
    MAX_SERIAL_INPUT_BYTES,
    ComponentInputRequest,
    SerialInputRequest,
    SimulationCommandResponse,
    SimulationStartErrorResponse,
    SimulationStartResponse,
    SimulationState,
)
from microlab_api.services import project_service
from microlab_api.services.compiler_service import CompilerClient, CompilerError
from microlab_api.services.simulation_service import (
    SimulationError,
    SimulationManager,
    Subscriber,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["simulation"])
ws_router = APIRouter(tags=["simulation"])

WS_PATH = "/ws/projects/{project_id}/simulation"

# Коды закрытия WebSocket (диапазон 4000–4999 — коды приложения).
WS_CLOSE_NOT_FOUND = 4404
WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_UNAVAILABLE = 4503

Session = Annotated[AsyncSession, Depends(get_session)]


def get_simulations(request: Request) -> SimulationManager:
    manager: SimulationManager = request.app.state.simulations
    return manager


Simulations = Annotated[SimulationManager, Depends(get_simulations)]


def _error(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}


_COMMON: dict[int | str, dict[str, Any]] = {
    404: _error("Project not found (PROJECT_NOT_FOUND)."),
    500: _error("Unexpected server error."),
    501: _error("Authentication is not configured (AUTH_NOT_CONFIGURED)."),
    502: _error("Simulator rejected the command (SIMULATION_START_FAILED, SIMULATOR_UNAVAILABLE)."),
    503: _error(
        "Database or simulator is unavailable (SIMULATOR_UNAVAILABLE), "
        "or all simulation slots are in use (SIMULATOR_BUSY)."
    ),
}
_COMMAND: dict[int | str, dict[str, Any]] = {
    **_COMMON,
    409: _error("No active simulation or wrong state for the command (SIMULATION_NOT_RUNNING)."),
}


async def _load_project(
    session: AsyncSession, user: CurrentUser, project_id: uuid.UUID
) -> tuple[str, dict[str, Any]]:
    project = await project_service.get_project(session, user, project_id)
    code, circuit = project.code, project.circuit
    # Транзакция чтения не должна оставаться открытой на время компиляции и симуляции.
    await session.close()
    return code, circuit


def _simulation_error(exc: SimulationError) -> JSONResponse:
    details = (
        [ErrorDetail(field="simulator", message=exc.message, code=exc.detail_code)]
        if exc.detail_code is not None
        else []
    )
    return error_response(exc.status_code, exc.code, exc.message, details)


@router.get(
    "/{project_id}/simulation",
    response_model=SimulationState,
    responses={**_COMMON},
    summary="Get the active or last simulation session of a project",
    operation_id="getSimulation",
)
async def get_simulation(
    project_id: uuid.UUID, session: Session, user: CurrentUser, simulations: Simulations
) -> SimulationState:
    await _load_project(session, user, project_id)
    current = simulations.current(project_id)
    return SimulationState(session=None if current is None else current.info())


@router.post(
    "/{project_id}/simulation/start",
    response_model=SimulationStartResponse,
    responses={
        **COMPILE_RESPONSES,
        **_COMMON,
        422: {
            "model": SimulationStartErrorResponse,
            "description": "Circuit has errors (CIRCUIT_HAS_ERRORS) or compilation failed "
            "(COMPILATION_FAILED).",
        },
    },
    summary="Validate, compile and start simulating the stored project",
    operation_id="startSimulation",
)
async def start_simulation(
    project_id: uuid.UUID,
    session: Session,
    user: CurrentUser,
    compiler: Annotated[CompilerClient, Depends(get_compiler)],
    simulations: Simulations,
) -> SimulationStartResponse | JSONResponse:
    code, circuit = await _load_project(session, user, project_id)

    registry = get_definition_registry()
    validation = validate_circuit(circuit, registry)
    validation_body = validation_response(validation)
    errors = [issue for issue in validation.issues if issue.severity is Severity.ERROR]
    document = parse_circuit(circuit).document
    if errors or document is None:
        body = SimulationStartErrorResponse(
            error=ErrorBody(
                code=ErrorCode.CIRCUIT_HAS_ERRORS,
                message="Circuit has errors; fix them before running the simulation.",
                details=[project_service.issue_detail(issue) for issue in errors],
            ),
            validation=validation_body,
        )
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    try:
        outcome = await compiler.compile(code)
    except CompilerError as exc:
        return error_response(exc.status_code, exc.code, exc.message)
    compilation = compile_response(outcome)
    firmware_hex = outcome.result.hex
    if not outcome.result.success or firmware_hex is None:
        body = SimulationStartErrorResponse(
            error=ErrorBody(
                code=ErrorCode.COMPILATION_FAILED,
                message="Sketch compilation failed.",
                details=[
                    ErrorDetail(
                        field=f"sketch:{d.line}:{d.column}" if d.line is not None else "sketch",
                        message=d.message,
                        code=d.severity,
                    )
                    for d in compilation.diagnostics
                    if d.severity == "error"
                ],
            ),
            compilation=compilation,
        )
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    payload = build_circuit_payload(document, validation.nets, registry)
    try:
        started = await simulations.start(project_id, firmware_hex, payload)
    except SimulationError as exc:
        return _simulation_error(exc)
    return SimulationStartResponse(
        session=started.info(),
        validation=validation_body,
        compilation=compilation.model_copy(update={"firmware": None}),
    )


async def _command(
    simulations: SimulationManager, project_id: uuid.UUID, command: str, **params: Any
) -> SimulationCommandResponse | JSONResponse:
    try:
        if command == "stop":
            current, result = await simulations.stop(project_id)
        else:
            current, result = await simulations.command(project_id, command, **params)
    except SimulationError as exc:
        return _simulation_error(exc)
    cycle = result.get("cycle")
    return SimulationCommandResponse(
        session=current.info(), applied_cycle=cycle if isinstance(cycle, int) else None
    )


def _command_route(command: str, summary: str) -> None:
    operation = "".join(part.capitalize() for part in command.split("_"))

    async def endpoint(
        project_id: uuid.UUID, session: Session, user: CurrentUser, simulations: Simulations
    ) -> SimulationCommandResponse | JSONResponse:
        await _load_project(session, user, project_id)
        return await _command(simulations, project_id, command)

    router.add_api_route(
        f"/{{project_id}}/simulation/{command}",
        endpoint,
        methods=["POST"],
        response_model=SimulationCommandResponse,
        responses=_COMMAND,
        summary=summary,
        operation_id=f"{operation.lower()}Simulation",
    )


_command_route("pause", "Pause the active simulation")
_command_route("resume", "Resume the paused simulation")
_command_route("stop", "Stop the active simulation")
_command_route("reset", "Reset the simulated MCU (external reset)")


@router.post(
    "/{project_id}/simulation/input",
    response_model=SimulationCommandResponse,
    responses={
        **_COMMAND,
        422: _error(
            "Invalid request or the simulator rejected the input (INVALID_SIMULATION_INPUT)."
        ),
    },
    summary="Change a component input (e.g. press a button)",
    operation_id="setSimulationInput",
)
async def set_input(
    project_id: uuid.UUID,
    body: ComponentInputRequest,
    session: Session,
    user: CurrentUser,
    simulations: Simulations,
) -> SimulationCommandResponse | JSONResponse:
    await _load_project(session, user, project_id)
    return await _command(
        simulations,
        project_id,
        "set_component_input",
        componentId=body.component_id,
        input=body.input.model_dump(mode="json"),
    )


@router.post(
    "/{project_id}/simulation/serial",
    response_model=SimulationCommandResponse,
    responses={
        **_COMMAND,
        422: _error("Invalid request, data longer than 4096 bytes, or rejected by the simulator."),
    },
    summary="Send data to the simulated UART0 (Serial) input",
    operation_id="sendSimulationSerial",
)
async def send_serial(
    project_id: uuid.UUID,
    body: SerialInputRequest,
    session: Session,
    user: CurrentUser,
    simulations: Simulations,
) -> SimulationCommandResponse | JSONResponse:
    if len(body.data.encode("utf-8")) > MAX_SERIAL_INPUT_BYTES:
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            "Request validation failed.",
            [ErrorDetail(field="body.data", message="Data exceeds 4096 bytes.", code="too_long")],
        )
    await _load_project(session, user, project_id)
    return await _command(simulations, project_id, "serial_input", data=body.data)


# --- WebSocket ---


def _same_origin(websocket: WebSocket) -> bool:
    """Браузер всегда передаёт Origin: подключение с чужой страницы отклоняется."""
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    return urlsplit(origin).netloc == websocket.headers.get("host")


async def _authorize(websocket: WebSocket, project_id: uuid.UUID) -> int | None:
    """Проверяет доступ к проекту; возвращает код закрытия или None."""
    database: Database = websocket.app.state.database
    try:
        async with database.sessionmaker() as db:
            user = await resolve_user(websocket.app.state.settings, db)
            await project_service.get_project(db, user, project_id)
    except ApiError as exc:
        if exc.code is ErrorCode.PROJECT_NOT_FOUND:
            return WS_CLOSE_NOT_FOUND
        if exc.code is ErrorCode.AUTH_NOT_CONFIGURED:
            return WS_CLOSE_UNAUTHORIZED
        return WS_CLOSE_UNAVAILABLE
    except DATABASE_UNAVAILABLE_ERRORS:
        return WS_CLOSE_UNAVAILABLE
    return None


async def _pump(websocket: WebSocket, subscriber: Subscriber) -> None:
    while True:
        text = await subscriber.queue.get()
        if text is None:
            # Очередь переполнена или API останавливается: клиент переподключится.
            await websocket.close(code=1013)
            return
        await websocket.send_text(text)


async def _drain(websocket: WebSocket) -> None:
    """Сообщения клиента не используются; чтение нужно, чтобы заметить отключение."""
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return


@ws_router.websocket(WS_PATH, name="simulation_events")
async def simulation_events(websocket: WebSocket, project_id: uuid.UUID) -> None:
    if not _same_origin(websocket):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    close_code = await _authorize(websocket, project_id)
    if close_code is not None:
        await websocket.close(code=close_code)
        return
    simulations: SimulationManager = websocket.app.state.simulations
    subscriber = simulations.subscribe(project_id)
    tasks = [
        asyncio.create_task(_pump(websocket, subscriber)),
        asyncio.create_task(_drain(websocket)),
    ]
    try:
        _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
    finally:
        simulations.unsubscribe(subscriber)
