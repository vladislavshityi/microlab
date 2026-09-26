import type { GridPoint } from "@microlab/circuit-schema";

import type { PinDirection } from "./geometry";

/**
 * Ортогональная трассировка проводов. Все функции работают в целых единицах сетки и
 * возвращают ломаные только из горизонтальных и вертикальных отрезков: диагональных
 * проводов не бывает. Трасса — только внешний вид; электрическое соединение задают
 * выводы на концах провода.
 *
 * Провод всегда выходит из вывода наружу символа (в направлении вывода с учётом
 * поворота) на STUB единиц и только потом поворачивает. Среди вариантов трассы
 * выбирается тот, что не разворачивается назад, не проходит через корпуса
 * компонентов на концах провода и имеет меньше изгибов и меньшую длину.
 */

/** Длина прямого участка у вывода, единицы сетки. */
const STUB = 1;

/** Прямоугольник корпуса (единицы сетки), через который провод не должен проходить. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const OFFSETS: Readonly<Record<PinDirection, GridPoint>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const OPPOSITE: Readonly<Record<PinDirection, PinDirection>> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
};

function samePoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Точка на расстоянии STUB от вывода наружу; для вывода без направления — сам вывод. */
function stubPoint(point: GridPoint, direction: PinDirection | null): GridPoint {
  if (direction === null) return { x: point.x, y: point.y };
  const offset = OFFSETS[direction];
  return { x: point.x + offset.x * STUB, y: point.y + offset.y * STUB };
}

/** Направление отрезка a → b (для ортогонального отрезка ненулевой длины). */
function directionOf(a: GridPoint, b: GridPoint): PinDirection | null {
  if (a.x === b.x && a.y !== b.y) return b.y > a.y ? "down" : "up";
  if (a.y === b.y && a.x !== b.x) return b.x > a.x ? "right" : "left";
  return null;
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

/** Проходит ли отрезок через внутреннюю область прямоугольника (по границе — можно). */
function crossesBox(a: GridPoint, b: GridPoint, box: Box): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (a.y === b.y) {
    return a.y > box.y && a.y < box.y + box.height && maxX > box.x && minX < box.x + box.width;
  }
  return a.x > box.x && a.x < box.x + box.width && maxY > box.y && minY < box.y + box.height;
}

/**
 * Оценка варианта трассы (меньше — лучше): развороты назад и проходы через корпуса
 * почти запрещены, затем учитываются изгибы и длина.
 */
function score(
  points: readonly GridPoint[],
  startDirection: PinDirection | null,
  endDirection: PinDirection | null,
  boxes: readonly Box[],
): number {
  let reversals = 0;
  let crossings = 0;
  let bends = 0;
  let length = 0;
  let previous = startDirection;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const direction = directionOf(a, b);
    if (direction === null) continue;
    if (previous !== null && direction === OPPOSITE[previous]) reversals += 1;
    else if (previous !== null && direction !== previous) bends += 1;
    for (const box of boxes) {
      if (crossesBox(a, b, box)) crossings += 1;
    }
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    previous = direction;
  }
  if (previous !== null && endDirection !== null && previous === OPPOSITE[endDirection]) {
    reversals += 1;
  }
  return reversals * 10_000 + crossings * 1_000 + bends * 10 + length;
}

/**
 * Ортогональный путь из `from` в `to`. `startDirection` — направление движения при
 * входе в `from` (путь не должен сразу развернуться назад), `endDirection` — направление
 * движения после `to`. Перебираются L-, Z- и U-образные варианты, включая обходы
 * корпусов; результат детерминирован.
 */
function connectOrthogonal(
  from: GridPoint,
  startDirection: PinDirection | null,
  to: GridPoint,
  endDirection: PinDirection | null,
  boxes: readonly Box[] = [],
): GridPoint[] {
  if (samePoint(from, to)) return [{ x: from.x, y: from.y }];
  const xs = new Set([from.x, to.x, Math.round((from.x + to.x) / 2)]);
  const ys = new Set([from.y, to.y, Math.round((from.y + to.y) / 2)]);
  for (const box of boxes) {
    xs.add(box.x - STUB);
    xs.add(box.x + box.width + STUB);
    ys.add(box.y - STUB);
    ys.add(box.y + box.height + STUB);
  }
  // Небольшой обход, если концы стоят вплотную друг к другу.
  ys.add(Math.min(from.y, to.y) - 2 * STUB);
  ys.add(Math.max(from.y, to.y) + 2 * STUB);
  xs.add(Math.min(from.x, to.x) - 2 * STUB);
  xs.add(Math.max(from.x, to.x) + 2 * STUB);

  const candidates: GridPoint[][] = [];
  if (from.x === to.x || from.y === to.y) candidates.push([from, to]);
  candidates.push([from, { x: to.x, y: from.y }, to], [from, { x: from.x, y: to.y }, to]);
  for (const x of xs) candidates.push([from, { x, y: from.y }, { x, y: to.y }, to]);
  for (const y of ys) candidates.push([from, { x: from.x, y }, { x: to.x, y }, to]);
  for (const x of xs) {
    for (const y of ys) {
      candidates.push([from, { x: from.x, y }, { x, y }, { x, y: to.y }, to]);
      candidates.push([from, { x, y: from.y }, { x, y }, { x: to.x, y }, to]);
    }
  }

  let best: GridPoint[] = [];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const simplified = simplifyPolyline(candidate);
    const value = score(simplified, startDirection, endDirection, boxes);
    if (value < bestScore) {
      best = simplified;
      bestScore = value;
    }
  }
  return best;
}

/**
 * Автоматическая трасса между двумя выводами: провод выходит из каждого вывода наружу,
 * затем соединяется ортогональным путём без разворотов и проходов через корпуса.
 */
export function autoRoute(
  from: GridPoint,
  fromDirection: PinDirection | null,
  to: GridPoint,
  toDirection: PinDirection | null,
  boxes: readonly Box[] = [],
): GridPoint[] {
  const start = stubPoint(from, fromDirection);
  const end = stubPoint(to, toDirection);
  const middle = connectOrthogonal(
    start,
    fromDirection,
    end,
    toDirection === null ? null : OPPOSITE[toDirection],
    boxes,
  );
  return simplifyPolyline([from, ...middle, to]);
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

/**
 * Полная трасса провода. Без сохранённых точек — автоматическая. С сохранёнными
 * точками (провод, отредактированный пользователем) средняя часть сохраняется, а
 * первый и последний участки каждый раз строятся заново от текущих выводов — так
 * провод остаётся ортогональным и привязанным к выводам после перемещения и поворота.
 */
export function wirePolyline(
  from: GridPoint,
  fromDirection: PinDirection | null,
  to: GridPoint,
  toDirection: PinDirection | null,
  route: readonly GridPoint[] | undefined,
  boxes: readonly Box[] = [],
): GridPoint[] {
  if (route === undefined || route.length === 0) {
    return autoRoute(from, fromDirection, to, toDirection, boxes);
  }
  const inner = orthogonalize(route);
  const first = inner[0];
  const last = inner.at(-1);
  if (first === undefined || last === undefined) {
    return autoRoute(from, fromDirection, to, toDirection, boxes);
  }
  const second = inner[1];
  const beforeLast = inner.at(-2);
  const head = connectOrthogonal(
    stubPoint(from, fromDirection),
    fromDirection,
    first,
    second === undefined ? null : directionOf(first, second),
    boxes,
  );
  const tail = connectOrthogonal(
    last,
    beforeLast === undefined || inner.length < 2 ? null : directionOf(beforeLast, last),
    stubPoint(to, toDirection),
    toDirection === null ? null : OPPOSITE[toDirection],
    boxes,
  );
  return simplifyPolyline([from, ...head, ...inner.slice(1), ...tail.slice(1), to]);
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
  const inner = moved.slice(index === 0 ? 0 : 1, index + 1 === points.length - 1 ? undefined : -1);
  return simplifyPolyline([first, ...inner, last]).slice(1, -1);
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
