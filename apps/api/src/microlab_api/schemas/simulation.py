"""Модели API симуляции проекта."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from microlab_api.schemas.base import ApiModel
from microlab_api.schemas.compile import CompileResponse
from microlab_api.schemas.errors import ErrorResponse
from microlab_api.schemas.validation import CircuitValidationResponse

type SimulationStatus = Literal["starting", "running", "paused", "stopped", "failed"]

# Лимит данных одной отправки в Serial совпадает с лимитом очереди входа worker.
MAX_SERIAL_INPUT_BYTES = 4096


class SimulationInfo(ApiModel):
    simulation_id: str
    project_id: uuid.UUID
    status: SimulationStatus
    start_time: datetime
    end_time: datetime | None
    error_code: str | None = Field(description="Code of the error that ended the session.")
    timestamp: int = Field(description="Simulated time in microseconds since power-on.")
    cycle: int = Field(description="MCU clock cycle (16 MHz) of the last known state.")


class SimulationState(ApiModel):
    session: SimulationInfo | None = Field(description="Active or last session; null if none.")


class SimulationStartResponse(ApiModel):
    session: SimulationInfo
    validation: CircuitValidationResponse = Field(
        description="Circuit issues (warnings and infos only: errors block the start)."
    )
    compilation: CompileResponse = Field(
        description="Compilation result; firmware is always null here (it is sent to the "
        "simulator only)."
    )


class SimulationStartErrorResponse(ErrorResponse):
    """Error envelope of the start endpoint with the result that blocked the start."""

    validation: CircuitValidationResponse | None = Field(
        default=None, description="Present for CIRCUIT_HAS_ERRORS."
    )
    compilation: CompileResponse | None = Field(
        default=None, description="Present for COMPILATION_FAILED."
    )


class ButtonInput(ApiModel):
    pressed: bool


class ComponentInputRequest(ApiModel):
    component_id: str = Field(min_length=1, max_length=64)
    input: ButtonInput


class SerialInputRequest(ApiModel):
    data: str = Field(
        min_length=1,
        max_length=MAX_SERIAL_INPUT_BYTES,
        description="Text sent to UART0 RX as UTF-8 (at most 4096 bytes).",
    )


class SimulationCommandResponse(ApiModel):
    session: SimulationInfo
    applied_cycle: int | None = Field(
        description="Cycle at which the simulator applied the command (time-slice boundary)."
    )
