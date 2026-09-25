import type { GridPoint } from "@microlab/circuit-schema";

import type { PinDirection } from "./geometry";

/**
 * Ортогональная трассировка проводов. Все функции работают в целых единицах сетки и
 * возвращают ломаные только из горизонтальных и вертикальных отрезков: диагональных
 * проводов не бывает. Трасса — только внешний вид; электрическое соединение задают
 * выводы на концах провода.
 */

function samePoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function isHorizontal(direction: PinDirection | null): boolean {
  return direction === "left" || direction === "right";
}

function isVertical(direction: PinDirection | null): boolean {
  return direction === "up" || direction === "down";
}

/** Убирает повторяющиеся точки и промежуточные точки на одной прямой. */
export function simplifyPolyline(points: readonly GridPoint[]): GridPoint[] {
  const deduplicated: GridPoint[] = [];
  for (const point of points) {
    const last = deduplicated.at(-1);
    if (last === undefined || !samePoint(last, point)) {
      deduplicated.push({ x: point.x, y: point.y });
    }
  }
  const result: GridPoint[] = [];
  for (const point of deduplicated) {
    const prev = result.at(-1);
    const prevPrev = result.at(-2);
    if (
      prev !== undefined &&
      prevPrev !== undefined &&
      ((prevPrev.x === prev.x && prev.x === point.x) || (prevPrev.y === prev.y && prev.y === point.y))
    ) {
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }
  }
  return result;
}

/**
 * Автоматическая трасса между двумя выводами: L или Z с учётом стороны, из которой
 * выходит каждый вывод. Середина Z округляется до узла сетки.
 */
export function autoRoute(
  from: GridPoint,
  fromDirection: PinDirection | null,
  to: GridPoint,
  toDirection: PinDirection | null,
): GridPoint[] {
  if (from.x === to.x || from.y === to.y) {
    return simplifyPolyline([from, to]);
  }
  if (isVertical(fromDirection) && isVertical(toDirection)) {
    const middleY = Math.round((from.y + to.y) / 2);
    return simplifyPolyline([from, { x: from.x, y: middleY }, { x: to.x, y: middleY }, to]);
  }
  if (isVertical(fromDirection) && !isVertical(toDirection)) {
    return simplifyPolyline([from, { x: from.x, y: to.y }, to]);
  }
  if (isHorizontal(fromDirection) && isVertical(toDirection)) {
    return simplifyPolyline([from, { x: to.x, y: from.y }, to]);
  }
  if (isVertical(toDirection)) {
    return simplifyPolyline([from, { x: to.x, y: from.y }, to]);
  }
  // Оба вывода горизонтальные (или направление неизвестно): Z через середину по X.
  const middleX = Math.round((from.x + to.x) / 2);
  return simplifyPolyline([from, { x: middleX, y: from.y }, { x: middleX, y: to.y }, to]);
}

/**
 * Ортогональная ломаная через заданные точки: между соседними точками, не лежащими на
 * одной горизонтали или вертикали, вставляется угол (сначала по горизонтали).
 */
export function orthogonalize(points: readonly GridPoint[]): GridPoint[] {
  const result: GridPoint[] = [];
  for (const point of points) {
    const prev = result.at(-1);
    if (prev !== undefined && prev.x !== point.x && prev.y !== point.y) {
      result.push({ x: point.x, y: prev.y });
    }
    result.push(point);
  }
  return simplifyPolyline(result);
}

/** Полная трасса провода: автоматическая или через сохранённые промежуточные точки. */
export function wirePolyline(
  from: GridPoint,
  fromDirection: PinDirection | null,
  to: GridPoint,
  toDirection: PinDirection | null,
  route: readonly GridPoint[] | undefined,
): GridPoint[] {
  if (route === undefined || route.length === 0) {
    return autoRoute(from, fromDirection, to, toDirection);
  }
  return orthogonalize([from, ...route, to]);
}

/**
 * Сдвигает отрезок `index` ломаной перпендикулярно его направлению на `delta` единиц
 * и возвращает новые промежуточные точки (без концов). Концы провода остаются на
 * выводах: если сдвигается крайний отрезок, у вывода добавляется перпендикулярный
 * отрезок. Возвращает null, если отрезка нет или он нулевой длины.
 */
export function moveSegment(
  points: readonly GridPoint[],
  index: number,
  delta: number,
): GridPoint[] | null {
  const start = points[index];
  const end = points[index + 1];
  if (start === undefined || end === undefined || samePoint(start, end)) {
    return null;
  }
  const horizontal = start.y === end.y;
  const shift = (point: GridPoint): GridPoint =>
    horizontal ? { x: point.x, y: point.y + delta } : { x: point.x + delta, y: point.y };

  const moved: GridPoint[] = points.map((point, i) =>
    i === index || i === index + 1 ? shift(point) : { x: point.x, y: point.y },
  );
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  // Концы на выводах не двигаются.
  const full = [first, ...moved.slice(index === 0 ? 0 : 1, index + 1 === points.length - 1 ? undefined : -1), last];
  return simplifyPolyline(full).slice(1, -1);
}

/** Отрезки ломаной (для отрисовки и перетаскивания). */
export function segments(points: readonly GridPoint[]): { from: GridPoint; to: GridPoint }[] {
  const result: { from: GridPoint; to: GridPoint }[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (from !== undefined && to !== undefined) {
      result.push({ from, to });
    }
  }
  return result;
}
