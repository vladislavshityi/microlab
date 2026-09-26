/** Типы компонентов с секцией «Во время симуляции» в панели свойств. */
const TYPES: ReadonlySet<string> = new Set(["potentiometer", "photoresistor", "piezo-buzzer", "servo"]);

export function hasSimulationInputs(type: string): boolean {
  return TYPES.has(type);
}
