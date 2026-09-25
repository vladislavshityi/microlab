/* Сгенерировано scripts/gen.mjs из packages/circuit-schema. Не редактировать вручную. */

/**
 * Identifier of a board, component or connection within the document. Dots are not allowed: pin references use the form componentId.pinId.
 *
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "InstanceId".
 */
export type InstanceId = string;
/**
 * Component definition type, e.g. resistor.
 *
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "ComponentType".
 */
export type ComponentType = string;
/**
 * Clockwise rotation in degrees.
 *
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "Rotation".
 */
export type Rotation = 0 | 90 | 180 | 270;
/**
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "PropertyValue".
 */
export type PropertyValue = number | string | boolean;

/**
 * MicroLab circuit document, schemaVersion 1. Coordinates are grid units: integers, 1 unit = 2.54 mm (0.1 inch). The board is addressable in connections by its id, like any component.
 */
export interface CircuitDocument {
  /**
   * Version of this document format. Any format change increments it.
   */
  schemaVersion: 1;
  board: BoardInstance;
  components: ComponentInstance[];
  connections: Connection[];
}
/**
 * Board instance. position defaults to the origin, rotation to 0.
 *
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "BoardInstance".
 */
export interface BoardInstance {
  id: InstanceId;
  type: ComponentType;
  position?: GridPoint;
  rotation?: Rotation;
}
/**
 * Point in grid units (integers, 1 unit = 2.54 mm).
 *
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "GridPoint".
 */
export interface GridPoint {
  x: number;
  y: number;
}
/**
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "ComponentInstance".
 */
export interface ComponentInstance {
  id: InstanceId;
  type: ComponentType;
  position: GridPoint;
  rotation: Rotation;
  /**
   * Property values by property id. Missing properties take the definition default.
   */
  properties: {
    [k: string]: PropertyValue | undefined;
  };
}
/**
 * Electrical connection (wire) between two pins. Appearance never affects connectivity.
 *
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "Connection".
 */
export interface Connection {
  id: InstanceId;
  from: PinRef;
  to: PinRef;
  /**
   * Visual metadata only; never used for electrical behavior.
   */
  color?: string;
  /**
   * Intermediate waypoints in grid units. Consecutive waypoints must be horizontal or vertical to each other.
   */
  route?: GridPoint[];
}
/**
 * This interface was referenced by `CircuitDocument`'s JSON-Schema
 * via the `definition` "PinRef".
 */
export interface PinRef {
  componentId: InstanceId;
  pinId: string;
}
