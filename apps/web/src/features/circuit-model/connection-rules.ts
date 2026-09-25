import { getComponentDefinition, type Connection, type PinRef } from "@microlab/circuit-schema";

import type { NormalizedCircuit } from "./circuit-document";
import { getPlacedInstance } from "./geometry";

/** Ключ вывода `componentId.pinId` (точка в id запрещена схемой, поэтому ключ однозначен). */
export function pinKey(pin: PinRef): string {
  return `${pin.componentId}.${pin.pinId}`;
}

export function samePin(a: PinRef, b: PinRef): boolean {
  return a.componentId === b.componentId && a.pinId === b.pinId;
}

/**
 * Причины, по которым новое соединение отклоняется редактором. Это не электрическая
 * проверка схемы: отклоняются только соединения, которые не имеют смысла в модели
 * (несуществующий вывод, вывод сам с собой, повтор уже существующего провода).
 */
export type ConnectionRejection = "UNKNOWN_PIN" | "SAME_PIN" | "DUPLICATE";

function pinExists(circuit: Pick<NormalizedCircuit, "board" | "components">, pin: PinRef): boolean {
  const instance = getPlacedInstance(circuit, pin.componentId);
  const definition = instance && getComponentDefinition(instance.type);
  return definition?.pins.some((candidate) => candidate.id === pin.pinId) ?? false;
}

export function checkNewConnection(
  circuit: Pick<NormalizedCircuit, "board" | "components" | "connections" | "connectionOrder">,
  from: PinRef,
  to: PinRef,
): ConnectionRejection | null {
  if (!pinExists(circuit, from) || !pinExists(circuit, to)) {
    return "UNKNOWN_PIN";
  }
  if (samePin(from, to)) {
    return "SAME_PIN";
  }
  const duplicate = circuit.connectionOrder.some((id) => {
    const connection = circuit.connections[id];
    return (
      connection !== undefined &&
      ((samePin(connection.from, from) && samePin(connection.to, to)) ||
        (samePin(connection.from, to) && samePin(connection.to, from)))
    );
  });
  return duplicate ? "DUPLICATE" : null;
}

/** Соединения по ключу вывода; кэшируется по ссылке на объект соединений. */
export type PinIndex = ReadonlyMap<string, readonly string[]>;

const pinIndexCache = new WeakMap<object, PinIndex>();

export function getPinIndex(
  connections: Readonly<Record<string, Connection>>,
  connectionOrder: readonly string[],
): PinIndex {
  const cached = pinIndexCache.get(connections);
  if (cached !== undefined) {
    return cached;
  }
  const index = new Map<string, string[]>();
  for (const id of connectionOrder) {
    const connection = connections[id];
    if (connection === undefined) continue;
    for (const pin of [connection.from, connection.to]) {
      const key = pinKey(pin);
      const list = index.get(key);
      if (list === undefined) {
        index.set(key, [id]);
      } else {
        list.push(id);
      }
    }
  }
  pinIndexCache.set(connections, index);
  return index;
}

/** Минимальное число концов проводов на одном выводе, при котором рисуется точка соединения. */
export const JUNCTION_MIN_ENDPOINTS = 3;
