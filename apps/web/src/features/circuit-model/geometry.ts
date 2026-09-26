import {
  getComponentDefinition,
  type ComponentDefinition,
  type GridPoint,
  type Rotation,
} from "@microlab/circuit-schema";

import type { NormalizedCircuit } from "./circuit-document";

/** Шаг основной сетки: 1 единица = 2,54 мм (0,1 дюйма). Координаты модели — целые единицы. */
export const GRID_MM = 2.54;

/**
 * Пикселей на единицу сетки при масштабе 100%. Преобразование детерминировано:
 * world(px) = grid × GRID_PX; grid = round(world / GRID_PX).
 */
export const GRID_PX = 20;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export function gridToWorld(point: GridPoint): { x: number; y: number } {
  return { x: point.x * GRID_PX, y: point.y * GRID_PX };
}

/** Ближайший узел сетки для точки холста (px). */
export function worldToGrid(point: { x: number; y: number }): GridPoint {
  // `+ 0` превращает -0 в 0, чтобы сериализация была стабильной.
  return { x: Math.round(point.x / GRID_PX) + 0, y: Math.round(point.y / GRID_PX) + 0 };
}

export interface Size {
  width: number;
  height: number;
}

/** Размер символа после поворота. */
export function rotatedSize(size: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

/**
 * Поворот точки символа по часовой стрелке. Повёрнутый символ снова вписывается в
 * прямоугольник с левым верхним углом в position экземпляра, поэтому целые координаты
 * выводов остаются целыми.
 */
export function rotatePoint(point: GridPoint, size: Size, rotation: Rotation): GridPoint {
  switch (rotation) {
    case 0:
      return { x: point.x, y: point.y };
    case 90:
      return { x: size.height - point.y, y: point.x };
    case 180:
      return { x: size.width - point.x, y: size.height - point.y };
    case 270:
      return { x: point.y, y: size.width - point.x };
  }
}

export function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}

/** Направление, в котором вывод «выходит» из символа; провод уходит от вывода в эту сторону. */
export type PinDirection = "left" | "right" | "up" | "down";

const CLOCKWISE: readonly PinDirection[] = ["up", "right", "down", "left"];

function rotateDirection(direction: PinDirection, rotation: Rotation): PinDirection {
  const index = CLOCKWISE.indexOf(direction) + rotation / 90;
  return CLOCKWISE[index % 4] ?? direction;
}

/** Размещённый на схеме объект (плата или компонент) в едином виде. */
export interface PlacedInstance {
  id: string;
  type: string;
  position: GridPoint;
  rotation: Rotation;
}

const ORIGIN: GridPoint = { x: 0, y: 0 };

/** Плата или компонент по id; у платы position и rotation необязательны. */
export function getPlacedInstance(
  circuit: Pick<NormalizedCircuit, "board" | "components">,
  id: string,
): PlacedInstance | undefined {
  if (id === circuit.board.id) {
    return toPlacedInstance(circuit.board);
  }
  return circuit.components[id];
}

/** Координаты вывода в единицах сетки на схеме; undefined, если вывода нет в определении. */
export function pinGridPosition(
  instance: PlacedInstance,
  definition: ComponentDefinition,
  pinId: string,
): GridPoint | undefined {
  const local = definition.visual.pins[pinId];
  if (local === undefined) {
    return undefined;
  }
  const rotated = rotatePoint(local, definition.visual, instance.rotation);
  return { x: instance.position.x + rotated.x, y: instance.position.y + rotated.y };
}

/** Сторона символа, на которой расположен вывод (с учётом поворота); null — вывод внутри. */
export function pinDirection(
  definition: ComponentDefinition,
  pinId: string,
  rotation: Rotation,
): PinDirection | null {
  const local = definition.visual.pins[pinId];
  if (local === undefined) {
    return null;
  }
  const { width, height } = definition.visual;
  let direction: PinDirection | null = null;
  if (local.x === 0) direction = "left";
  else if (local.x === width) direction = "right";
  else if (local.y === 0) direction = "up";
  else if (local.y === height) direction = "down";
  return direction === null ? null : rotateDirection(direction, rotation);
}

/** Абсолютная позиция вывода по ссылке componentId.pinId. */
export function resolvePin(
  circuit: Pick<NormalizedCircuit, "board" | "components">,
  componentId: string,
  pinId: string,
): { point: GridPoint; direction: PinDirection | null } | undefined {
  const instance = getPlacedInstance(circuit, componentId);
  return instance === undefined ? undefined : resolveInstancePin(instance, pinId);
}

/** Плата или компонент в едином виде (у платы position и rotation необязательны). */
export function toPlacedInstance(source: {
  id: string;
  type: string;
  position?: GridPoint;
  rotation?: Rotation;
}): PlacedInstance {
  return {
    id: source.id,
    type: source.type,
    position: source.position ?? ORIGIN,
    rotation: source.rotation ?? 0,
  };
}

/** Позиция и направление вывода экземпляра; undefined, если тип или вывод неизвестен. */
export function resolveInstancePin(
  source: { id: string; type: string; position?: GridPoint; rotation?: Rotation },
  pinId: string,
): { point: GridPoint; direction: PinDirection | null } | undefined {
  const instance = toPlacedInstance(source);
  const definition = getComponentDefinition(instance.type);
  if (definition === undefined) {
    return undefined;
  }
  const point = pinGridPosition(instance, definition, pinId);
  return point === undefined
    ? undefined
    : { point, direction: pinDirection(definition, pinId, instance.rotation) };
}

/**
 * Прямоугольник корпуса экземпляра в единицах сетки (с учётом поворота). Для гнёзд
 * (макетная плата) — undefined: провода проходят над ними.
 */
export function instanceBox(source: {
  id: string;
  type: string;
  position?: GridPoint;
  rotation?: Rotation;
}): { x: number; y: number; width: number; height: number } | undefined {
  const instance = toPlacedInstance(source);
  const definition = getComponentDefinition(instance.type);
  if (definition === undefined || definition.socket === true) {
    return undefined;
  }
  const size = rotatedSize(definition.visual, instance.rotation);
  return { x: instance.position.x, y: instance.position.y, width: size.width, height: size.height };
}
