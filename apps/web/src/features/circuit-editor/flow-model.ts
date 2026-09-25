import { Position, type Edge, type Node, type NodeHandle } from "@xyflow/react";
import {
  getComponentDefinition,
  type BoardInstance,
  type ComponentDefinition,
  type ComponentInstance,
  type Connection,
  type Rotation,
} from "@microlab/circuit-schema";

import type { NormalizedCircuit } from "@/features/circuit-model/circuit-document";
import { pinKey } from "@/features/circuit-model/connection-rules";
import {
  GRID_PX,
  pinDirection,
  rotatedSize,
  rotatePoint,
  type PinDirection,
} from "@/features/circuit-model/geometry";
import { formatQuantityText } from "@/features/circuit-model/quantity";
import { localized } from "@/i18n/localized";
import { locale, t } from "@/i18n/t";
import type { CircuitSelection } from "@/stores/circuit-store";

/**
 * Представление Circuit Model для React Flow. Узлы и рёбра вычисляются из circuitStore
 * и никогда не являются источником истины. Объекты кэшируются: неизменившийся компонент
 * получает тот же объект узла, поэтому React Flow не перерисовывает его.
 */

export interface CircuitNodeData extends Record<string, unknown> {
  componentId: string;
  definition: ComponentDefinition;
  rotation: Rotation;
  properties: ComponentInstance["properties"] | undefined;
  isBoard: boolean;
}

/** Тип узла React Flow: гнёзда (макетная плата) рисуются отдельным компонентом. */
export type CircuitNodeType = "circuit" | "breadboard";
export type CircuitFlowNode = Node<CircuitNodeData, CircuitNodeType>;
export type WireFlowEdge = Edge<Record<string, never>, "wire">;

/** Размер области захвата вывода, px. */
export const PIN_HIT_PX = 12;

const HANDLE_POSITION: Readonly<Record<PinDirection, Position>> = {
  left: Position.Left,
  right: Position.Right,
  up: Position.Top,
  down: Position.Bottom,
};

export interface PinLayout {
  id: string;
  /** Центр вывода относительно левого верхнего угла узла, px. */
  x: number;
  y: number;
  position: Position;
}

const pinLayoutCache = new Map<string, readonly PinLayout[]>();

/** Положения выводов в узле с учётом поворота. */
export function pinLayouts(definition: ComponentDefinition, rotation: Rotation): readonly PinLayout[] {
  const key = `${definition.type}:${rotation}`;
  const cached = pinLayoutCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const layouts: PinLayout[] = [];
  for (const pin of definition.pins) {
    const local = definition.visual.pins[pin.id];
    if (local === undefined) continue;
    const rotated = rotatePoint(local, definition.visual, rotation);
    const direction = pinDirection(definition, pin.id, rotation);
    layouts.push({
      id: pin.id,
      x: rotated.x * GRID_PX,
      y: rotated.y * GRID_PX,
      position: direction === null ? Position.Top : HANDLE_POSITION[direction],
    });
  }
  pinLayoutCache.set(key, layouts);
  return layouts;
}

const handlesCache = new WeakMap<readonly PinLayout[], NodeHandle[]>();

/**
 * Выводы узла для React Flow (позиции концов проводов). Задаются данными, а не DOM,
 * поэтому у макетной платы нет 400 DOM-элементов выводов. Кэшируются по раскладке.
 */
function nodeHandles(layouts: readonly PinLayout[]): NodeHandle[] {
  const cached = handlesCache.get(layouts);
  if (cached !== undefined) {
    return cached;
  }
  const handles: NodeHandle[] = layouts.map((layout) => ({
    id: layout.id,
    type: "source",
    position: layout.position,
    x: layout.x - PIN_HIT_PX / 2,
    y: layout.y - PIN_HIT_PX / 2,
    width: PIN_HIT_PX,
    height: PIN_HIT_PX,
  }));
  handlesCache.set(layouts, handles);
  return handles;
}

/** Слои холста: плата и макетная плата под проводами, компоненты над ними. */
export const Z_INDEX = { base: 0, wire: 1, component: 2 } as const;

/** Доступное имя компонента на холсте: «Резистор r1, 220 Ω». */
export function componentAccessibleName(
  definition: ComponentDefinition,
  id: string,
  properties: ComponentInstance["properties"] | undefined,
): string {
  const summary = componentSummary(definition, properties);
  const base = `${localized(definition.displayName)} ${id}`;
  return summary === null ? base : `${base}, ${summary}`;
}

/** Краткое значение основного свойства (например, сопротивление) или null. */
export function componentSummary(
  definition: ComponentDefinition,
  properties: ComponentInstance["properties"] | undefined,
): string | null {
  // Подпись показывается только для сопротивления: остальные свойства видны в панели свойств.
  const primary = definition.properties.find((property) => property.type === "number" && property.unit === "ohm");
  if (primary?.type !== "number") {
    return null;
  }
  const value = properties?.[primary.id] ?? primary.default;
  return typeof value === "number" ? formatQuantityText(value, primary.unit, locale) : null;
}

interface NodeCacheEntry {
  source: ComponentInstance | BoardInstance;
  selected: boolean;
  node: CircuitFlowNode;
}

/** Строитель узлов с кэшем между вызовами (один экземпляр на холст). */
export function createNodeBuilder() {
  const cache = new Map<string, NodeCacheEntry>();

  function build(
    source: ComponentInstance | BoardInstance,
    isBoard: boolean,
    selected: boolean,
  ): CircuitFlowNode | null {
    const cached = cache.get(source.id);
    if (cached?.source === source && cached.selected === selected) {
      return cached.node;
    }
    const definition = getComponentDefinition(source.type);
    if (definition === undefined) {
      return null;
    }
    const rotation = source.rotation ?? 0;
    const properties = "properties" in source ? source.properties : undefined;
    const previousData = cached?.node.data;
    // data сохраняет ссылку при простом перемещении: символ не перерисовывается.
    const data: CircuitNodeData =
      previousData?.definition === definition &&
      previousData.rotation === rotation &&
      previousData.properties === properties
        ? previousData
        : { componentId: source.id, definition, rotation, properties, isBoard };
    const size = rotatedSize(definition.visual, rotation);
    const width = size.width * GRID_PX;
    const height = size.height * GRID_PX;
    const position = source.position ?? { x: 0, y: 0 };
    const lowered = isBoard || definition.socket === true;
    const node: CircuitFlowNode = {
      id: source.id,
      type: definition.socket === true ? "breadboard" : "circuit",
      position: { x: position.x * GRID_PX, y: position.y * GRID_PX },
      data,
      selected,
      width,
      height,
      measured: { width, height },
      handles: nodeHandles(pinLayouts(definition, rotation)),
      deletable: !isBoard,
      zIndex: lowered ? Z_INDEX.base : Z_INDEX.component,
      ariaLabel: componentAccessibleName(definition, source.id, properties),
    };
    cache.set(source.id, { source, selected, node });
    return node;
  }

  return (
    circuit: Pick<NormalizedCircuit, "board" | "components" | "componentOrder">,
    selection: CircuitSelection,
  ): CircuitFlowNode[] => {
    const selected = new Set(selection.componentIds);
    const nodes: CircuitFlowNode[] = [];
    const boardNode = build(circuit.board, true, selected.has(circuit.board.id));
    if (boardNode !== null) nodes.push(boardNode);
    for (const id of circuit.componentOrder) {
      const component = circuit.components[id];
      if (component === undefined) continue;
      const node = build(component, false, selected.has(id));
      if (node !== null) nodes.push(node);
    }
    const alive = new Set([circuit.board.id, ...circuit.componentOrder]);
    for (const id of cache.keys()) {
      if (!alive.has(id)) cache.delete(id);
    }
    return nodes;
  };
}

/** Строитель рёбер с кэшем между вызовами. */
export function createEdgeBuilder() {
  const cache = new Map<string, { connection: Connection; selected: boolean; edge: WireFlowEdge }>();

  return (
    circuit: Pick<NormalizedCircuit, "connections" | "connectionOrder">,
    selection: CircuitSelection,
  ): WireFlowEdge[] => {
    const selected = new Set(selection.connectionIds);
    const edges: WireFlowEdge[] = [];
    for (const id of circuit.connectionOrder) {
      const connection = circuit.connections[id];
      if (connection === undefined) continue;
      const isSelected = selected.has(id);
      const cached = cache.get(id);
      if (cached?.connection === connection && cached.selected === isSelected) {
        edges.push(cached.edge);
        continue;
      }
      const edge: WireFlowEdge = {
        id,
        type: "wire",
        source: connection.from.componentId,
        sourceHandle: connection.from.pinId,
        target: connection.to.componentId,
        targetHandle: connection.to.pinId,
        selected: isSelected,
        zIndex: Z_INDEX.wire,
        data: {},
        ariaLabel: t("canvas.wire.label", {
          id,
          from: pinKey(connection.from),
          to: pinKey(connection.to),
        }),
      };
      cache.set(id, { connection, selected: isSelected, edge });
      edges.push(edge);
    }
    const alive = new Set(circuit.connectionOrder);
    for (const id of cache.keys()) {
      if (!alive.has(id)) cache.delete(id);
    }
    return edges;
  };
}
