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
export type PropertyUnit = "ohm" | "volt" | "percent";
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
  properties: PropertyDefinition[];
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
