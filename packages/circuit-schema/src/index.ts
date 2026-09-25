import type { CircuitDocument } from "./generated/circuit";
import type { ComponentCategory, ComponentDefinition } from "./generated/component-definition";
import { COMPONENT_DEFINITIONS } from "./generated/definitions";

export type * from "./generated/circuit";
export type * from "./generated/component-definition";
export { COMPONENT_DEFINITIONS };

/** Версия формата документа схемы, которую понимает этот пакет. */
export const CIRCUIT_SCHEMA_VERSION = 1 satisfies CircuitDocument["schemaVersion"];

/** Порядок категорий в библиотеке компонентов. */
export const COMPONENT_CATEGORIES: readonly ComponentCategory[] = [
  "board",
  "basic",
  "passive",
  "output",
  "sensors",
  "displays",
];

const DEFINITIONS_BY_TYPE: ReadonlyMap<string, ComponentDefinition> = new Map(
  COMPONENT_DEFINITIONS.map((definition) => [definition.type, definition]),
);

/** Определение компонента или платы по типу; undefined, если тип неизвестен. */
export function getComponentDefinition(type: string): ComponentDefinition | undefined {
  return DEFINITIONS_BY_TYPE.get(type);
}
