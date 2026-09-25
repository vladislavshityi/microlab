import type { Rotation } from "@microlab/circuit-schema";

/**
 * SVG-преобразование символа, нарисованного в единицах сетки без поворота: поворот по
 * часовой стрелке со сдвигом, чтобы повёрнутый символ начинался в (0, 0).
 */
export function rotationTransform(rotation: Rotation, width: number, height: number): string | undefined {
  switch (rotation) {
    case 0:
      return undefined;
    case 90:
      return `translate(${height} 0) rotate(90)`;
    case 180:
      return `translate(${width} ${height}) rotate(180)`;
    case 270:
      return `translate(0 ${width}) rotate(270)`;
  }
}
