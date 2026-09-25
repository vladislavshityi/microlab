import {
  CIRCUIT_SCHEMA_VERSION,
  getComponentDefinition,
  type CircuitDocument,
  type Connection,
} from "@microlab/circuit-schema";

import { defaultProperties } from "./circuit-commands";

const TYPES = ["resistor", "led", "push-button"] as const;

/**
 * Детерминированная нагрузочная схема для проверки отзывчивости редактора:
 * плата, `componentCount` компонентов в сетке и `connectionCount` соединений между
 * случайными (с фиксированным seed) выводами без повторов. С `withBreadboard` под
 * компонентами лежит макетная плата: часть выводов попадает в её отверстия.
 *
 * В dev-режиме её можно загрузить из консоли браузера:
 *   const { createStressCircuit } = await import("/src/features/circuit-model/stress-circuit.ts");
 *   const { useCircuitStore } = await import("/src/stores/circuit-store.ts");
 *   useCircuitStore.getState().loadDocument(createStressCircuit());
 */
export function createStressCircuit(
  componentCount = 100,
  connectionCount = 300,
  seed = 1,
  withBreadboard = false,
): CircuitDocument {
  let state = seed;
  // LCG (Numerical Recipes): одинаковый seed — одинаковая схема.
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };

  const components: CircuitDocument["components"] = [];
  for (let i = 0; i < componentCount; i += 1) {
    const type = TYPES[i % TYPES.length] ?? "resistor";
    const definition = getComponentDefinition(type);
    if (definition === undefined) continue;
    components.push({
      id: `c${i + 1}`,
      type,
      position: { x: 20 + (i % 10) * 8, y: (Math.floor(i / 10) % 10) * 5 },
      rotation: 0,
      properties: defaultProperties(definition),
    });
  }

  const pins = components.flatMap((component) =>
    (getComponentDefinition(component.type)?.pins ?? []).map((pin) => ({
      componentId: component.id,
      pinId: pin.id,
    })),
  );
  const seen = new Set<string>();
  const connections: Connection[] = [];
  for (let attempt = 0; connections.length < connectionCount && attempt < connectionCount * 20; attempt += 1) {
    const from = pins[Math.floor(random() * pins.length)];
    const to = pins[Math.floor(random() * pins.length)];
    if (from === undefined || to === undefined) break;
    const a = `${from.componentId}.${from.pinId}`;
    const b = `${to.componentId}.${to.pinId}`;
    if (a === b || seen.has(`${a}|${b}`) || seen.has(`${b}|${a}`)) continue;
    seen.add(`${a}|${b}`);
    connections.push({ id: `w${connections.length + 1}`, from, to });
  }

  if (withBreadboard) {
    components.unshift({ id: "bb1", type: "breadboard", position: { x: 19, y: 0 }, rotation: 0, properties: {} });
  }

  return {
    schemaVersion: CIRCUIT_SCHEMA_VERSION,
    board: { id: "uno1", type: "arduino-uno-r3", position: { x: 0, y: 0 }, rotation: 0 },
    components,
    connections,
  };
}
