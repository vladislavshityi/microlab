import type { BoardInstance, ComponentInstance, Connection, GridPoint } from "@microlab/circuit-schema";

import { instanceBox, resolveInstancePin } from "./geometry";
import { wirePolyline, type Box } from "./routing";

type Placed = ComponentInstance | BoardInstance;

/**
 * Ломаная провода в единицах сетки: концы — текущие позиции выводов (с учётом
 * перемещения и поворота), участки у выводов идут наружу символа, корпуса компонентов
 * на концах провода обходятся. Единственное место, где из модели строится вид провода.
 */
export function connectionPolyline(
  connection: Pick<Connection, "from" | "to" | "route">,
  fromSource: Placed,
  toSource: Placed,
): GridPoint[] | null {
  const from = resolveInstancePin(fromSource, connection.from.pinId);
  const to = resolveInstancePin(toSource, connection.to.pinId);
  if (from === undefined || to === undefined) return null;
  const boxes: Box[] = [];
  // Корпус учитывается, только если вывод на его границе: к отверстию гнезда провод
  // подходит сверху, а не в обход.
  const fromBox = from.direction === null ? undefined : instanceBox(fromSource);
  const toBox = to.direction === null ? undefined : instanceBox(toSource);
  if (fromBox !== undefined) boxes.push(fromBox);
  if (toBox !== undefined && fromSource.id !== toSource.id) boxes.push(toBox);
  return wirePolyline(from.point, from.direction, to.point, to.direction, connection.route, boxes);
}
