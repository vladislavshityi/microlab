import type { Rotation } from "@microlab/circuit-schema";

/**
 * Геометрия элементов символов, общая для статического символа и слоя симуляции
 * (единицы сетки, система координат определения компонента до поворота).
 */

/** Сегменты 7-сегментного индикатора: линии a–g и точка dp. */
export const SEGMENT_LINES: Readonly<Record<string, readonly [number, number, number, number]>> = {
  a: [1.35, 1.3, 2.65, 1.3],
  b: [2.85, 1.5, 2.85, 2.8],
  c: [2.85, 3.2, 2.85, 4.5],
  d: [1.35, 4.7, 2.65, 4.7],
  e: [1.15, 3.2, 1.15, 4.5],
  f: [1.15, 1.5, 1.15, 2.8],
  g: [1.35, 3.0, 2.65, 3.0],
};
export const SEGMENT_DP = { cx: 3.3, cy: 4.75, r: 0.14 } as const;
export const SEGMENT_WIDTH = 0.26;

/** Корпус RGB-светодиода. */
export const RGB_BODY = { cx: 1.5, cy: 1.2, r: 1.0 } as const;

/** Корпус пьезоизлучателя. */
export const PIEZO_BODY = { cx: 2, cy: 1.2, r: 1.05 } as const;

/** Вал и качалка сервопривода. */
export const SERVO_SHAFT = { cx: 3.6, cy: 2, r: 0.35, horn: 1.3 } as const;

/** Конец качалки для угла 0…180° (0° — вправо, 90° — вверх, 180° — влево). */
export function servoHornEnd(angle: number): { x: number; y: number } {
  const rad = (Math.min(180, Math.max(0, angle)) * Math.PI) / 180;
  return { x: SERVO_SHAFT.cx + SERVO_SHAFT.horn * Math.cos(rad), y: SERVO_SHAFT.cy - SERVO_SHAFT.horn * Math.sin(rad) };
}

/** Корпус (резистивный слой) потенциометра по x: движок в положении p (0…1). */
export const POT_TRACK = { x0: 1, x1: 3, y: 2 } as const;

export function potWiperX(position: number): number {
  return POT_TRACK.x0 + (POT_TRACK.x1 - POT_TRACK.x0) * Math.min(1, Math.max(0, position));
}

/**
 * Координата x определения компонента (до поворота) для точки экрана внутри узла:
 * нужна элементам управления, которые двигаются вдоль оси символа (движок потенциометра).
 */
export function definitionX(rotation: Rotation, width: number, rect: DOMRect, clientX: number, clientY: number): number {
  const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  switch (rotation) {
    case 90:
      return fy * width;
    case 180:
      return (1 - fx) * width;
    case 270:
      return (1 - fy) * width;
    default:
      return fx * width;
  }
}
