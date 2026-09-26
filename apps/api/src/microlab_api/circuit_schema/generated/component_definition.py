# Сгенерировано из packages/circuit-schema. Не редактировать вручную.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class InternalConnection(RootModel[list[str]]):
    root: Annotated[list[str], Field(min_length=2)]


class PinId(RootModel[str]):
    root: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]


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


class McuPin(RootModel[str]):
    root: Annotated[str, Field(pattern="^P[A-Z][0-7]$")]


class GpioGroupCurrentLimit(BaseModel):
    """
    Limit for the sum of currents of a group of MCU port pins.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    direction: Literal["source", "sink"]
    mcu_pins: Annotated[list[McuPin], Field(alias="mcuPins", min_length=1)]
    max_ma: Annotated[float, Field(alias="maxMa", gt=0.0)]


class ResistorModel(BaseModel):
    """
    Two-terminal resistor; resistance in ohms comes from a number property.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["resistor"]
    terminals: Annotated[list[PinId], Field(max_length=2, min_length=2)]
    resistance_property: Annotated[
        str,
        Field(alias="resistanceProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId"),
    ]


class LedModel(BaseModel):
    """
    Light-emitting diode; forward voltage in volts comes from a number property.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["led"]
    anode: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    cathode: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    forward_voltage_property: Annotated[
        str,
        Field(
            alias="forwardVoltageProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId"
        ),
    ]


class SwitchModel(BaseModel):
    """
    Switch between two terminals; open or closed at run time.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["switch"]
    terminals: Annotated[list[PinId], Field(max_length=2, min_length=2)]


class PotentiometerModel(BaseModel):
    """
    Potentiometer: resistance between the end terminals, split by the wiper position (0 % = wiper at terminals[0]).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["potentiometer"]
    terminals: Annotated[list[PinId], Field(max_length=2, min_length=2)]
    wiper: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    resistance_property: Annotated[
        str,
        Field(alias="resistanceProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId"),
    ]
    position_property: Annotated[
        str, Field(alias="positionProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")
    ]


class PhotoresistorModel(BaseModel):
    """
    Photoresistor: R = R10 * (E / 10 lx)^(-gamma), all parameters are number properties.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["photoresistor"]
    terminals: Annotated[list[PinId], Field(max_length=2, min_length=2)]
    illuminance_property: Annotated[
        str,
        Field(alias="illuminanceProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId"),
    ]
    resistance_at10_lux_property: Annotated[
        str,
        Field(
            alias="resistanceAt10LuxProperty",
            pattern="^[a-z][A-Za-z0-9]{0,63}$",
            title="PropertyId",
        ),
    ]
    gamma_property: Annotated[
        str, Field(alias="gammaProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")
    ]


class LedChannel(BaseModel):
    """
    One LED of an LED array: its own pin and forward voltage property.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z][a-z0-9]{0,15}$")]
    pin: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    forward_voltage_property: Annotated[
        str,
        Field(
            alias="forwardVoltageProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId"
        ),
    ]


class LedArrayModel(BaseModel):
    """
    Several LEDs with one common terminal (RGB LED, 7-segment display). The enum property selects the polarity: common-cathode (channel pin = anode) or common-anode (channel pin = cathode).
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["led-array"]
    common: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    polarity_property: Annotated[
        str, Field(alias="polarityProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")
    ]
    channels: Annotated[list[LedChannel], Field(min_length=1)]


class PiezoModel(BaseModel):
    """
    Passive piezo buzzer: no DC path between the terminals; sound frequency is measured from the voltage across it.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["piezo"]
    positive: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    negative: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]


class ServoModel(BaseModel):
    """
    Hobby servo: control pulse width on the signal pin sets the angle; power and ground pins must be supplied.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    kind: Literal["servo"]
    signal: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    power: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    ground: Annotated[str, Field(pattern="^[A-Za-z0-9][A-Za-z0-9_]{0,31}$", title="PinId")]
    min_pulse_property: Annotated[
        str, Field(alias="minPulseProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")
    ]
    max_pulse_property: Annotated[
        str, Field(alias="maxPulseProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")
    ]
    min_supply_property: Annotated[
        str,
        Field(alias="minSupplyProperty", pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId"),
    ]


class NumberPropertyDefinition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z][A-Za-z0-9]{0,63}$", title="PropertyId")]
    display_name: Annotated[LocalizedText, Field(alias="displayName")]
    type: Literal["number"]
    unit: Annotated[
        Literal["ohm", "volt", "percent", "lux", "microsecond", "none"], Field(title="PropertyUnit")
    ]
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


class BoardElectricalLimits(BaseModel):
    """
    Electrical values used by circuit validation. Operating limits only, never absolute maximum ratings.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    io_voltage: Annotated[float, Field(alias="ioVoltage", gt=0.0)]
    """
    Nominal I/O logic voltage, V.
    """
    gpio_pin_current_ma: Annotated[float, Field(alias="gpioPinCurrentMa", gt=0.0)]
    """
    Operating current limit per GPIO pin (source or sink), mA.
    """
    gpio_group_current_limits: Annotated[
        list[GpioGroupCurrentLimit], Field(alias="gpioGroupCurrentLimits")
    ]


class BoardInfo(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    mcu: Annotated[str, Field(min_length=1)]
    fqbn: Annotated[str, Field(pattern="^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+$")]
    clock_hz: Annotated[int, Field(alias="clockHz", ge=1)]
    electrical_limits: Annotated[BoardElectricalLimits | None, Field(alias="electricalLimits")] = (
        None
    )


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
    socket: bool | None = None
    """
    true for socket components such as a breadboard: a pin of another component (not a board and not a socket) that lies exactly on the same grid point as a socket pin is electrically connected to it. Visual proximity without exact coincidence never connects.
    """
    properties: list[NumberPropertyDefinition | EnumPropertyDefinition]
    electrical_model: Annotated[
        ResistorModel
        | LedModel
        | SwitchModel
        | PotentiometerModel
        | PhotoresistorModel
        | LedArrayModel
        | PiezoModel
        | ServoModel
        | None,
        Field(alias="electricalModel", title="ElectricalModel"),
    ] = None
    """
    Electrical model used by circuit validation and simulation.
    """
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
