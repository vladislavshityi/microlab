# Сгенерировано из packages/circuit-schema. Не редактировать вручную.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class InternalConnection(RootModel[list[str]]):
    root: Annotated[list[str], Field(min_length=2)]


class LocalizedText(BaseModel):
    """
    UI text: translation key plus the Russian text.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    key: Annotated[str, Field(pattern="^[a-z][A-Za-z0-9]*(\\.[a-z0-9][A-Za-z0-9-]*)+$")]
    ru: Annotated[str, Field(min_length=1)]


class PinDefinition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    name: Annotated[str, Field(min_length=1)]
    electrical_type: Annotated[
        Literal[
            "power-input",
            "power-output",
            "ground",
            "digital-input",
            "digital-output",
            "analog-input",
            "analog-output",
            "bidirectional",
            "passive",
        ],
        Field(alias="electricalType", title="ElectricalType"),
    ]
    voltage_domain: Annotated[
        Literal["5V", "3V3", "VIN"] | None, Field(alias="voltageDomain", title="VoltageDomain")
    ] = None
    """
    Supply domain the pin belongs to.
    """
    capabilities: (
        list[
            Literal[
                "digital-io",
                "pwm",
                "adc",
                "adc-reference",
                "uart-rx",
                "uart-tx",
                "int0",
                "int1",
                "spi-ss",
                "spi-mosi",
                "spi-miso",
                "spi-sck",
                "i2c-sda",
                "i2c-scl",
                "builtin-led",
                "reset",
            ]
        ]
        | None
    ) = None
    arduino_pin: Annotated[int | None, Field(alias="arduinoPin", ge=0)] = None
    """
    Arduino pin number used by pinMode() and similar (boards only).
    """
    mcu_pin: Annotated[str | None, Field(alias="mcuPin", pattern="^P[A-Z][0-7]$")] = None
    """
    Microcontroller port pin, e.g. PB5 (boards only).
    """


class BoardInfo(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    mcu: Annotated[str, Field(min_length=1)]
    fqbn: Annotated[str, Field(pattern="^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+$")]
    clock_hz: Annotated[int, Field(alias="clockHz", ge=1)]


class EnumOption(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    value: Annotated[str, Field(pattern="^[a-z][a-z0-9-]*$")]
    label: LocalizedText


class PinPosition(BaseModel):
    """
    Pin position in grid units, relative to the top-left corner of the symbol.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    x: int
    y: int


class NumberPropertyDefinition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")]
    display_name: Annotated[LocalizedText, Field(alias="displayName")]
    type: Literal["number"]
    unit: Annotated[Literal["ohm", "volt", "percent"], Field(title="PropertyUnit")]
    default: float
    minimum: float
    maximum: float
    presets: list[float] | None = None
    """
    Suggested values for the UI; any value within [minimum, maximum] is valid.
    """
    simulated: bool
    """
    false: the simulator ignores the value, the UI must label it as metadata only.
    """


class EnumPropertyDefinition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")]
    display_name: Annotated[LocalizedText, Field(alias="displayName")]
    type: Literal["enum"]
    default: str
    options: Annotated[list[EnumOption], Field(min_length=1)]
    simulated: bool
    """
    false: the simulator ignores the value, the UI must label it as metadata only.
    """


class VisualModel(BaseModel):
    """
    Symbol size and pin positions relative to the top-left corner, in grid units.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    width: Annotated[int, Field(ge=1)]
    height: Annotated[int, Field(ge=1)]
    pins: dict[str, PinPosition]


class ComponentDefinition(BaseModel):
    """
    Definition of a board or component type. Geometry is in grid units (integers, 1 unit = 2.54 mm).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    type: Annotated[str, Field(pattern="^[a-z][a-z0-9-]{0,63}$")]
    display_name: Annotated[LocalizedText, Field(alias="displayName")]
    description: LocalizedText
    category: Annotated[
        Literal["board", "basic", "passive", "output", "sensors", "displays"],
        Field(title="ComponentCategory"),
    ]
    board: BoardInfo | None = None
    pins: Annotated[list[PinDefinition], Field(min_length=1)]
    internal_connections: Annotated[
        list[InternalConnection] | None, Field(alias="internalConnections")
    ] = None
    """
    Groups of pin ids that are always the same net (inside the component itself).
    """
    properties: list[NumberPropertyDefinition | EnumPropertyDefinition]
    simulation_accuracy: Annotated[
        Literal["DIGITAL", "BASIC_ELECTRICAL", "BEHAVIORAL", "CONNECTIVITY"],
        Field(alias="simulationAccuracy", title="SimulationAccuracy"),
    ]
    """
    DIGITAL: logic levels only; BASIC_ELECTRICAL: simple electrical model; BEHAVIORAL: behavioral model; CONNECTIVITY: connectivity only.
    """
    limitations: list[str]
    """
    Known limitations of the model, short sentences in Russian.
    """
    visual: VisualModel
