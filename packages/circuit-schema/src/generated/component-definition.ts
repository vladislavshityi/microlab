/* Сгенерировано scripts/gen.mjs из packages/circuit-schema. Не редактировать вручную. */

/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "ComponentCategory".
 */
export type ComponentCategory = "board" | "basic" | "passive" | "output" | "sensors" | "displays";
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PinId".
 */
export type PinId = string;
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "ElectricalType".
 */
export type ElectricalType =
  | "power-input"
  | "power-output"
  | "ground"
  | "digital-input"
  | "digital-output"
  | "analog-input"
  | "analog-output"
  | "bidirectional"
  | "passive";
/**
 * Supply domain the pin belongs to.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "VoltageDomain".
 */
export type VoltageDomain = "5V" | "3V3" | "VIN";
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PinCapability".
 */
export type PinCapability =
  | "digital-io"
  | "pwm"
  | "adc"
  | "adc-reference"
  | "uart-rx"
  | "uart-tx"
  | "int0"
  | "int1"
  | "spi-ss"
  | "spi-mosi"
  | "spi-miso"
  | "spi-sck"
  | "i2c-sda"
  | "i2c-scl"
  | "builtin-led"
  | "reset";
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PropertyDefinition".
 */
export type PropertyDefinition = NumberPropertyDefinition | EnumPropertyDefinition;
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PropertyId".
 */
export type PropertyId = string;
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PropertyUnit".
 */
export type PropertyUnit = "ohm" | "volt" | "percent" | "lux" | "microsecond" | "none";
/**
 * Electrical model used by circuit validation and simulation.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "ElectricalModel".
 */
export type ElectricalModel =
  | ResistorModel
  | LedModel
  | SwitchModel
  | PotentiometerModel
  | PhotoresistorModel
  | LedArrayModel
  | PiezoModel
  | ServoModel;
/**
 * DIGITAL: logic levels only; BASIC_ELECTRICAL: simple electrical model; BEHAVIORAL: behavioral model; CONNECTIVITY: connectivity only.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "SimulationAccuracy".
 */
export type SimulationAccuracy = "DIGITAL" | "BASIC_ELECTRICAL" | "BEHAVIORAL" | "CONNECTIVITY";

/**
 * Definition of a board or component type. Geometry is in grid units (integers, 1 unit = 2.54 mm).
 */
export interface ComponentDefinition {
  type: string;
  displayName: LocalizedText;
  description: LocalizedText;
  category: ComponentCategory;
  board?: BoardInfo;
  /**
   * @minItems 1
   */
  pins: [PinDefinition, ...PinDefinition[]];
  /**
   * Groups of pin ids that are always the same net (inside the component itself).
   */
  internalConnections?: [string, string, ...string[]][];
  /**
   * true for socket components such as a breadboard: a pin of another component (not a board and not a socket) that lies exactly on the same grid point as a socket pin is electrically connected to it. Visual proximity without exact coincidence never connects.
   */
  socket?: boolean;
  properties: PropertyDefinition[];
  electricalModel?: ElectricalModel;
  simulationAccuracy: SimulationAccuracy;
  /**
   * Known limitations of the model, short sentences in Russian.
   */
  limitations: string[];
  visual: VisualModel;
}
/**
 * UI text: translation key plus the Russian text.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "LocalizedText".
 */
export interface LocalizedText {
  key: string;
  ru: string;
}
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "BoardInfo".
 */
export interface BoardInfo {
  mcu: string;
  fqbn: string;
  clockHz: number;
  electricalLimits?: BoardElectricalLimits;
}
/**
 * Electrical values used by circuit validation. Operating limits only, never absolute maximum ratings.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "BoardElectricalLimits".
 */
export interface BoardElectricalLimits {
  /**
   * Nominal I/O logic voltage, V.
   */
  ioVoltage: number;
  /**
   * Operating current limit per GPIO pin (source or sink), mA.
   */
  gpioPinCurrentMa: number;
  gpioGroupCurrentLimits: GpioGroupCurrentLimit[];
}
/**
 * Limit for the sum of currents of a group of MCU port pins.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "GpioGroupCurrentLimit".
 */
export interface GpioGroupCurrentLimit {
  direction: "source" | "sink";
  /**
   * @minItems 1
   */
  mcuPins: [string, ...string[]];
  maxMa: number;
}
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PinDefinition".
 */
export interface PinDefinition {
  id: PinId;
  name: string;
  electricalType: ElectricalType;
  voltageDomain?: VoltageDomain;
  capabilities?: PinCapability[];
  /**
   * Arduino pin number used by pinMode() and similar (boards only).
   */
  arduinoPin?: number;
  /**
   * Microcontroller port pin, e.g. PB5 (boards only).
   */
  mcuPin?: string;
}
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "NumberPropertyDefinition".
 */
export interface NumberPropertyDefinition {
  id: PropertyId;
  displayName: LocalizedText;
  type: "number";
  unit: PropertyUnit;
  default: number;
  minimum: number;
  maximum: number;
  /**
   * Suggested values for the UI; any value within [minimum, maximum] is valid.
   */
  presets?: number[];
  /**
   * false: the simulator ignores the value, the UI must label it as metadata only.
   */
  simulated: boolean;
}
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "EnumPropertyDefinition".
 */
export interface EnumPropertyDefinition {
  id: PropertyId;
  displayName: LocalizedText;
  type: "enum";
  default: string;
  /**
   * @minItems 1
   */
  options: [EnumOption, ...EnumOption[]];
  /**
   * false: the simulator ignores the value, the UI must label it as metadata only.
   */
  simulated: boolean;
}
/**
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "EnumOption".
 */
export interface EnumOption {
  value: string;
  label: LocalizedText;
}
/**
 * Two-terminal resistor; resistance in ohms comes from a number property.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "ResistorModel".
 */
export interface ResistorModel {
  kind: "resistor";
  /**
   * @minItems 2
   * @maxItems 2
   */
  terminals: [PinId, PinId];
  resistanceProperty: PropertyId;
}
/**
 * Light-emitting diode; forward voltage in volts comes from a number property.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "LedModel".
 */
export interface LedModel {
  kind: "led";
  anode: PinId;
  cathode: PinId;
  forwardVoltageProperty: PropertyId;
}
/**
 * Switch between two terminals; open or closed at run time.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "SwitchModel".
 */
export interface SwitchModel {
  kind: "switch";
  /**
   * @minItems 2
   * @maxItems 2
   */
  terminals: [PinId, PinId];
}
/**
 * Potentiometer: resistance between the end terminals, split by the wiper position (0 % = wiper at terminals[0]).
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PotentiometerModel".
 */
export interface PotentiometerModel {
  kind: "potentiometer";
  /**
   * @minItems 2
   * @maxItems 2
   */
  terminals: [PinId, PinId];
  wiper: PinId;
  resistanceProperty: PropertyId;
  positionProperty: PropertyId;
}
/**
 * Photoresistor: R = R10 * (E / 10 lx)^(-gamma), all parameters are number properties.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PhotoresistorModel".
 */
export interface PhotoresistorModel {
  kind: "photoresistor";
  /**
   * @minItems 2
   * @maxItems 2
   */
  terminals: [PinId, PinId];
  illuminanceProperty: PropertyId;
  resistanceAt10LuxProperty: PropertyId;
  gammaProperty: PropertyId;
}
/**
 * Several LEDs with one common terminal (RGB LED, 7-segment display). The enum property selects the polarity: common-cathode (channel pin = anode) or common-anode (channel pin = cathode).
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "LedArrayModel".
 */
export interface LedArrayModel {
  kind: "led-array";
  common: PinId;
  polarityProperty: PropertyId;
  /**
   * @minItems 1
   */
  channels: [LedChannel, ...LedChannel[]];
}
/**
 * One LED of an LED array: its own pin and forward voltage property.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "LedChannel".
 */
export interface LedChannel {
  id: string;
  pin: PinId;
  forwardVoltageProperty: PropertyId;
}
/**
 * Passive piezo buzzer: no DC path between the terminals; sound frequency is measured from the voltage across it.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PiezoModel".
 */
export interface PiezoModel {
  kind: "piezo";
  positive: PinId;
  negative: PinId;
}
/**
 * Hobby servo: control pulse width on the signal pin sets the angle; power and ground pins must be supplied.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "ServoModel".
 */
export interface ServoModel {
  kind: "servo";
  signal: PinId;
  power: PinId;
  ground: PinId;
  minPulseProperty: PropertyId;
  maxPulseProperty: PropertyId;
  minSupplyProperty: PropertyId;
}
/**
 * Symbol size and pin positions relative to the top-left corner, in grid units.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "VisualModel".
 */
export interface VisualModel {
  width: number;
  height: number;
  pins: {
    [k: string]: PinPosition | undefined;
  };
}
/**
 * Pin position in grid units, relative to the top-left corner of the symbol.
 *
 * This interface was referenced by `ComponentDefinition`'s JSON-Schema
 * via the `definition` "PinPosition".
 */
export interface PinPosition {
  x: number;
  y: number;
}
