import {
  getComponentDefinition,
  type ComponentDefinition,
  type ComponentInstance,
  type Connection,
  type GridPoint,
  type PinRef,
  type PropertyValue,
} from "@microlab/circuit-schema";

import type { NormalizedCircuit } from "./circuit-document";
import { checkNewConnection, type ConnectionRejection } from "./connection-rules";
import { getPlacedInstance, nextRotation, rotatedSize, type PlacedInstance } from "./geometry";
import { collectIds, CONNECTION_ID_PREFIX, idPrefixForType, nextId } from "./ids";

/**
 * Команды редактирования схемы — чистые функции над нормализованной схемой.
 * Каждая возвращает новую схему (неизменённые объекты переиспользуются) или ту же
 * ссылку, если изменений нет; история отмены строится в circuitStore поверх них.
 */

export type CircuitCommandErrorCode =
  | "UNKNOWN_COMPONENT_TYPE"
  | "BOARD_TYPE"
  | "UNKNOWN_COMPONENT"
  | "UNKNOWN_PROPERTY"
  | "INVALID_PROPERTY_VALUE"
  | ConnectionRejection;

export class CircuitCommandError extends Error {
  readonly code: CircuitCommandErrorCode;

  constructor(code: CircuitCommandErrorCode, message: string) {
    super(message);
    this.name = "CircuitCommandError";
    this.code = code;
  }
}

function requireDefinition(type: string): ComponentDefinition {
  const definition = getComponentDefinition(type);
  if (definition === undefined) {
    throw new CircuitCommandError("UNKNOWN_COMPONENT_TYPE", `Unknown component type ${type}.`);
  }
  return definition;
}

/** Значения свойств по умолчанию из определения (записываются явно). */
export function defaultProperties(definition: ComponentDefinition): Record<string, PropertyValue> {
  return Object.fromEntries(definition.properties.map((property) => [property.id, property.default]));
}

/** Добавляет компонент; position — левый верхний угол в единицах сетки. */
export function addComponent(
  circuit: NormalizedCircuit,
  type: string,
  position: GridPoint,
): { circuit: NormalizedCircuit; id: string } {
  const definition = requireDefinition(type);
  if (definition.category === "board") {
    throw new CircuitCommandError("BOARD_TYPE", "The board is always present and cannot be added.");
  }
  const id = nextId(idPrefixForType(type), collectIds(circuit));
  const component: ComponentInstance = {
    id,
    type,
    position: { x: position.x, y: position.y },
    rotation: 0,
    properties: defaultProperties(definition),
  };
  return {
    circuit: {
      ...circuit,
      components: { ...circuit.components, [id]: component },
      componentOrder: [...circuit.componentOrder, id],
    },
    id,
  };
}

/**
 * Удаляет компоненты и соединения. Плата не удаляется; соединения, подключённые к
 * удаляемым компонентам, удаляются вместе с ними.
 */
export function removeItems(
  circuit: NormalizedCircuit,
  componentIds: readonly string[],
  connectionIds: readonly string[],
): NormalizedCircuit {
  const removedComponents = new Set(componentIds.filter((id) => id in circuit.components));
  const removedConnections = new Set(connectionIds.filter((id) => id in circuit.connections));
  for (const id of circuit.connectionOrder) {
    const connection = circuit.connections[id];
    if (
      connection !== undefined &&
      (removedComponents.has(connection.from.componentId) || removedComponents.has(connection.to.componentId))
    ) {
      removedConnections.add(id);
    }
  }
  if (removedComponents.size === 0 && removedConnections.size === 0) {
    return circuit;
  }
  const components = Object.fromEntries(
    Object.entries(circuit.components).filter(([id]) => !removedComponents.has(id)),
  );
  const connections = Object.fromEntries(
    Object.entries(circuit.connections).filter(([id]) => !removedConnections.has(id)),
  );
  return {
    ...circuit,
    components,
    componentOrder: circuit.componentOrder.filter((id) => !removedComponents.has(id)),
    connections,
    connectionOrder: circuit.connectionOrder.filter((id) => !removedConnections.has(id)),
  };
}

function withPlacement(
  circuit: NormalizedCircuit,
  id: string,
  placement: Pick<PlacedInstance, "position" | "rotation">,
): NormalizedCircuit {
  if (id === circuit.board.id) {
    return { ...circuit, board: { ...circuit.board, position: placement.position, rotation: placement.rotation } };
  }
  const component = circuit.components[id];
  if (component === undefined) {
    return circuit;
  }
  return {
    ...circuit,
    components: {
      ...circuit.components,
      [id]: { ...component, position: placement.position, rotation: placement.rotation },
    },
  };
}

/** Перемещает плату или компоненты в новые позиции (единицы сетки). */
export function moveItems(
  circuit: NormalizedCircuit,
  positions: Readonly<Record<string, GridPoint>>,
): NormalizedCircuit {
  let result = circuit;
  for (const [id, position] of Object.entries(positions)) {
    const instance = getPlacedInstance(result, id);
    if (instance === undefined) continue;
    if (instance.position.x === position.x && instance.position.y === position.y) continue;
    result = withPlacement(result, id, { position: { x: position.x, y: position.y }, rotation: instance.rotation });
  }
  return result;
}

/**
 * Поворачивает на 90° по часовой стрелке. Позиция корректируется так, чтобы центр
 * символа остался на месте (с округлением до узла сетки).
 */
export function rotateItems(circuit: NormalizedCircuit, ids: readonly string[]): NormalizedCircuit {
  let result = circuit;
  for (const id of ids) {
    const instance = getPlacedInstance(result, id);
    const definition = instance && getComponentDefinition(instance.type);
    if (instance === undefined || definition === undefined) continue;
    const rotation = nextRotation(instance.rotation);
    const before = rotatedSize(definition.visual, instance.rotation);
    const after = rotatedSize(definition.visual, rotation);
    const position = {
      x: instance.position.x + Math.round((before.width - after.width) / 2),
      y: instance.position.y + Math.round((before.height - after.height) / 2),
    };
    result = withPlacement(result, id, { position, rotation });
  }
  return result;
}

/** Проверяет значение свойства по определению; возвращает нормализованное значение. */
export function validatePropertyValue(
  definition: ComponentDefinition,
  propertyId: string,
  value: PropertyValue,
): PropertyValue {
  const property = definition.properties.find((candidate) => candidate.id === propertyId);
  if (property === undefined) {
    throw new CircuitCommandError("UNKNOWN_PROPERTY", `Unknown property ${propertyId}.`);
  }
  if (property.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < property.minimum || value > property.maximum) {
      throw new CircuitCommandError("INVALID_PROPERTY_VALUE", `Invalid value for ${propertyId}.`);
    }
    return value;
  }
  if (typeof value !== "string" || !property.options.some((option) => option.value === value)) {
    throw new CircuitCommandError("INVALID_PROPERTY_VALUE", `Invalid value for ${propertyId}.`);
  }
  return value;
}

export function setProperty(
  circuit: NormalizedCircuit,
  componentId: string,
  propertyId: string,
  value: PropertyValue,
): NormalizedCircuit {
  const component = circuit.components[componentId];
  if (component === undefined) {
    throw new CircuitCommandError("UNKNOWN_COMPONENT", `Unknown component ${componentId}.`);
  }
  const normalized = validatePropertyValue(requireDefinition(component.type), propertyId, value);
  if (component.properties[propertyId] === normalized) {
    return circuit;
  }
  return {
    ...circuit,
    components: {
      ...circuit.components,
      [componentId]: { ...component, properties: { ...component.properties, [propertyId]: normalized } },
    },
  };
}

/** Создаёт соединение между выводами; некорректные соединения отклоняются с кодом причины. */
export function addConnection(
  circuit: NormalizedCircuit,
  from: PinRef,
  to: PinRef,
): { circuit: NormalizedCircuit; id: string } {
  const rejection = checkNewConnection(circuit, from, to);
  if (rejection !== null) {
    throw new CircuitCommandError(rejection, `Connection rejected: ${rejection}.`);
  }
  const id = nextId(CONNECTION_ID_PREFIX, collectIds(circuit));
  const connection: Connection = {
    id,
    from: { componentId: from.componentId, pinId: from.pinId },
    to: { componentId: to.componentId, pinId: to.pinId },
  };
  return {
    circuit: {
      ...circuit,
      connections: { ...circuit.connections, [id]: connection },
      connectionOrder: [...circuit.connectionOrder, id],
    },
    id,
  };
}

function updateConnection(
  circuit: NormalizedCircuit,
  id: string,
  update: (connection: Connection) => Connection,
): NormalizedCircuit {
  const connection = circuit.connections[id];
  if (connection === undefined) {
    return circuit;
  }
  return { ...circuit, connections: { ...circuit.connections, [id]: update(connection) } };
}

/** Цвет провода — только визуальные метаданные; undefined — цвет по умолчанию. */
export function setConnectionColor(
  circuit: NormalizedCircuit,
  id: string,
  color: string | undefined,
): NormalizedCircuit {
  if (circuit.connections[id]?.color === color) {
    return circuit;
  }
  return updateConnection(circuit, id, (connection) => {
    const next: Connection = { ...connection };
    delete next.color;
    return color === undefined ? next : { ...next, color };
  });
}

/** Промежуточные точки трассы; пустой список или undefined — автоматическая трасса. */
export function setConnectionRoute(
  circuit: NormalizedCircuit,
  id: string,
  route: readonly GridPoint[] | undefined,
): NormalizedCircuit {
  const current = circuit.connections[id]?.route;
  const next = route === undefined || route.length === 0 ? undefined : route.map((p) => ({ x: p.x, y: p.y }));
  if (JSON.stringify(current) === JSON.stringify(next)) {
    return circuit;
  }
  return updateConnection(circuit, id, (connection) => {
    const updated: Connection = { ...connection };
    delete updated.route;
    return next === undefined ? updated : { ...updated, route: next };
  });
}

/** Смещение копий при дублировании, единицы сетки. */
export const DUPLICATE_OFFSET = 2;

/**
 * Дублирует компоненты (плата не дублируется). Соединения между дублируемыми
 * компонентами копируются вместе с ними; соединения с остальной схемой — нет.
 */
export function duplicateComponents(
  circuit: NormalizedCircuit,
  ids: readonly string[],
): { circuit: NormalizedCircuit; ids: string[] } {
  let result = circuit;
  const mapping = new Map<string, string>();
  for (const id of ids) {
    const component = circuit.components[id];
    if (component === undefined) continue;
    const added = addComponent(result, component.type, {
      x: component.position.x + DUPLICATE_OFFSET,
      y: component.position.y + DUPLICATE_OFFSET,
    });
    const copy = added.circuit.components[added.id];
    if (copy === undefined) continue;
    result = {
      ...added.circuit,
      components: {
        ...added.circuit.components,
        [added.id]: { ...copy, rotation: component.rotation, properties: { ...component.properties } },
      },
    };
    mapping.set(id, added.id);
  }
  for (const connectionId of circuit.connectionOrder) {
    const connection = circuit.connections[connectionId];
    if (connection === undefined) continue;
    const from = mapping.get(connection.from.componentId);
    const to = mapping.get(connection.to.componentId);
    if (from === undefined || to === undefined) continue;
    const added = addConnection(
      result,
      { componentId: from, pinId: connection.from.pinId },
      { componentId: to, pinId: connection.to.pinId },
    );
    result = connection.color === undefined ? added.circuit : setConnectionColor(added.circuit, added.id, connection.color);
    if (connection.route !== undefined) {
      result = setConnectionRoute(
        result,
        added.id,
        connection.route.map((p) => ({ x: p.x + DUPLICATE_OFFSET, y: p.y + DUPLICATE_OFFSET })),
      );
    }
  }
  return { circuit: result, ids: [...mapping.values()] };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  // Зазор в одну единицу сетки, чтобы выводы соседних символов не совпадали.
  return a.x < b.x + b.width + 1 && b.x < a.x + a.width + 1 && a.y < b.y + b.height + 1 && b.y < a.y + a.height + 1;
}

function occupiedBoxes(circuit: NormalizedCircuit): Box[] {
  const boxes: Box[] = [];
  for (const id of [circuit.board.id, ...circuit.componentOrder]) {
    const instance = getPlacedInstance(circuit, id);
    const definition = instance && getComponentDefinition(instance.type);
    if (instance === undefined || definition === undefined) continue;
    const size = rotatedSize(definition.visual, instance.rotation);
    boxes.push({ ...instance.position, ...size });
  }
  return boxes;
}

/**
 * Ближайшая к желаемой свободная позиция для нового символа: если место занято
 * (с зазором в одну единицу), позиция сдвигается вправо, затем вниз.
 */
export function findFreePosition(
  circuit: NormalizedCircuit,
  position: GridPoint,
  size: { width: number; height: number },
): GridPoint {
  const boxes = occupiedBoxes(circuit);
  const free = (candidate: GridPoint) =>
    !boxes.some((box) => overlaps(box, { ...candidate, width: size.width, height: size.height }));
  for (let row = 0; row < 20; row += 1) {
    for (let column = 0; column < 40; column += 1) {
      const candidate = { x: position.x + column * DUPLICATE_OFFSET, y: position.y + row * DUPLICATE_OFFSET };
      if (free(candidate)) {
        return candidate;
      }
    }
  }
  return { x: position.x, y: position.y };
}
