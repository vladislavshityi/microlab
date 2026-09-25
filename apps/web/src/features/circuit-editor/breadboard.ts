import {
  getComponentDefinition,
  type ComponentDefinition,
  type GridPoint,
  type PinRef,
  type Rotation,
} from "@microlab/circuit-schema";

import type { NormalizedCircuit } from "@/features/circuit-model/circuit-document";
import { useCircuitStore } from "@/stores/circuit-store";
import { pinGridPosition, rotatePoint, rotatedSize, toPlacedInstance, type Size } from "@/features/circuit-model/geometry";

/**
 * Геометрия гнёзд (макетной платы) для редактора. Отверстия рисуются одной SVG-картинкой,
 * а отверстие под указателем определяется по координатам — без DOM-элемента на каждое
 * отверстие. Правило подключения то же, что в netlist: только точное совпадение по сетке.
 */

/** Половина стороны квадрата отверстия, единицы сетки. */
const HOLE_HALF = 0.17;

export interface SocketLayout {
  /** Отверстие по точке «x,y» в повёрнутых локальных координатах. */
  holeAt: ReadonlyMap<string, string>;
  /** Отверстия одной полосы (внутреннего соединения) по id отверстия, включая его само. */
  groupOf: ReadonlyMap<string, readonly string[]>;
  /** Контуры всех отверстий (локальные координаты без поворота) — одна строка path. */
  holesPath: string;
}

const layoutCache = new Map<string, SocketLayout>();

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/** Раскладка отверстий для определения и поворота (кэшируется). */
export function socketLayout(definition: ComponentDefinition, rotation: Rotation): SocketLayout {
  const cacheKey = `${definition.type}:${rotation}`;
  const cached = layoutCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const holeAt = new Map<string, string>();
  const parts: string[] = [];
  for (const pin of definition.pins) {
    const local = definition.visual.pins[pin.id];
    if (local === undefined) continue;
    const rotated = rotatePoint(local, definition.visual, rotation);
    holeAt.set(key(rotated.x, rotated.y), pin.id);
    parts.push(holePath(local, HOLE_HALF));
  }
  const groupOf = new Map<string, readonly string[]>();
  for (const group of definition.internalConnections ?? []) {
    for (const pinId of group) groupOf.set(pinId, group);
  }
  const layout: SocketLayout = { holeAt, groupOf, holesPath: parts.join("") };
  layoutCache.set(cacheKey, layout);
  return layout;
}

/** Квадрат отверстия вокруг точки (локальные координаты), фрагмент SVG path. */
export function holePath(point: GridPoint, half: number): string {
  const size = half * 2;
  return `M${point.x - half} ${point.y - half}h${size}v${size}h${-size}z`;
}

/**
 * Отверстие под точкой экрана: `rect` — прямоугольник узла в координатах окна (повёрнутый
 * символ). Точка округляется до ближайшего узла сетки; вне отверстия — undefined.
 */
export function holeAtClientPoint(
  definition: ComponentDefinition,
  rotation: Rotation,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): string | undefined {
  const size: Size = rotatedSize(definition.visual, rotation);
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const x = ((clientX - rect.left) / rect.width) * size.width;
  const y = ((clientY - rect.top) / rect.height) * size.height;
  const gx = Math.round(x);
  const gy = Math.round(y);
  // Только в пределах отверстия, а не всей клетки сетки.
  if (Math.abs(x - gx) > 0.35 || Math.abs(y - gy) > 0.35) return undefined;
  return socketLayout(definition, rotation).holeAt.get(key(gx, gy));
}

/** Экранный прямоугольник отверстия (для подсказки). */
export function holeClientRect(
  definition: ComponentDefinition,
  rotation: Rotation,
  pinId: string,
  rect: { left: number; top: number; width: number; height: number },
): { left: number; top: number; width: number } | undefined {
  const local = definition.visual.pins[pinId];
  if (local === undefined) return undefined;
  const size = rotatedSize(definition.visual, rotation);
  const point = rotatePoint(local, definition.visual, rotation);
  const unit = rect.width / size.width;
  return { left: rect.left + (point.x - 0.5) * unit, top: rect.top + (point.y - 0.5) * unit, width: unit };
}

type OccupancySource = Pick<NormalizedCircuit, "board" | "components" | "componentOrder" | "connections" | "connectionOrder">;

const occupancyCache = new WeakMap<object, { connections: object; board: object; result: ReadonlyMap<string, string> }>();

/**
 * Занятые отверстия всех гнёзд: в отверстии стоит вывод компонента (точное совпадение)
 * или заканчивается провод. Результат — строка id отверстий по id гнезда (стабильное
 * значение для подписки на store).
 */
export function occupiedHoles(circuit: OccupancySource): ReadonlyMap<string, string> {
  const cached = occupancyCache.get(circuit.components);
  if (cached?.connections === circuit.connections && cached.board === circuit.board) {
    return cached.result;
  }
  const sockets: { id: string; holes: Map<string, string> }[] = [];
  const plugged: GridPoint[] = [];
  for (const id of circuit.componentOrder) {
    const component = circuit.components[id];
    const definition = component && getComponentDefinition(component.type);
    if (component === undefined || definition === undefined || definition.category === "board") continue;
    const instance = toPlacedInstance(component);
    if (definition.socket === true) {
      const holes = new Map<string, string>();
      for (const pin of definition.pins) {
        const point = pinGridPosition(instance, definition, pin.id);
        if (point !== undefined) holes.set(key(point.x, point.y), pin.id);
      }
      sockets.push({ id, holes });
    } else {
      for (const pin of definition.pins) {
        const point = pinGridPosition(instance, definition, pin.id);
        if (point !== undefined) plugged.push(point);
      }
    }
  }
  const occupied = new Map<string, Set<string>>();
  for (const socket of sockets) {
    const set = new Set<string>();
    for (const point of plugged) {
      const hole = socket.holes.get(key(point.x, point.y));
      if (hole !== undefined) set.add(hole);
    }
    occupied.set(socket.id, set);
  }
  for (const connectionId of circuit.connectionOrder) {
    const connection = circuit.connections[connectionId];
    if (connection === undefined) continue;
    for (const end of [connection.from, connection.to]) {
      occupied.get(end.componentId)?.add(end.pinId);
    }
  }
  const result = new Map<string, string>();
  for (const [id, set] of occupied) result.set(id, [...set].sort().join(" "));
  occupancyCache.set(circuit.components, { connections: circuit.connections, board: circuit.board, result });
  return result;
}

/** Отверстия гнезда, к которым подходят провода: id через пробел (стабильное значение). */
export function wireEndHoles(circuit: Pick<NormalizedCircuit, "connections" | "connectionOrder">, socketId: string): string {
  const pins = new Set<string>();
  for (const id of circuit.connectionOrder) {
    const connection = circuit.connections[id];
    if (connection === undefined) continue;
    if (connection.from.componentId === socketId) pins.add(connection.from.pinId);
    if (connection.to.componentId === socketId) pins.add(connection.to.pinId);
  }
  return [...pins].sort().join(" ");
}

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/**
 * Отверстие макетной платы под точкой экрана (для завершения провода отпусканием кнопки
 * мыши над отверстием). `element` — элемент под указателем.
 */
export function breadboardHoleFromPoint(element: Element, clientX: number, clientY: number): PinRef | null {
  const host = element.closest<HTMLElement>("[data-breadboard-component]");
  const componentId = host?.dataset["breadboardComponent"];
  if (host === null || componentId === undefined) return null;
  const component = useCircuitStore.getState().components[componentId];
  const definition = component === undefined ? undefined : getComponentDefinition(component.type);
  const rotation = ROTATIONS.find((value) => String(value) === host.dataset["breadboardRotation"]);
  if (definition === undefined || rotation === undefined) return null;
  const pinId = holeAtClientPoint(definition, rotation, host.getBoundingClientRect(), clientX, clientY);
  return pinId === undefined ? null : { componentId, pinId };
}
