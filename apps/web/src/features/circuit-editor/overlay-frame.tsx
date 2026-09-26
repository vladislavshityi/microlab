import type { ReactNode } from "react";
import type { ComponentDefinition, Rotation } from "@microlab/circuit-schema";

import { rotationTransform } from "./rotation";

export interface OverlayFrameProps {
  definition: ComponentDefinition;
  rotation: Rotation;
  widthPx: number;
  heightPx: number;
  children: ReactNode;
}

export type FrameProps = Omit<OverlayFrameProps, "children">;

/** SVG в тех же единицах сетки и с тем же поворотом, что и символ компонента. */
export function OverlayFrame({ definition, rotation, widthPx, heightPx, children }: OverlayFrameProps) {
  const { width, height } = definition.visual;
  const quarter = rotation === 90 || rotation === 270;
  return (
    <svg
      aria-hidden="true"
      width={widthPx}
      height={heightPx}
      viewBox={`0 0 ${quarter ? height : width} ${quarter ? width : height}`}
      overflow="visible"
      className="pointer-events-none absolute top-0 left-0"
    >
      <g transform={rotationTransform(rotation, width, height)}>{children}</g>
    </svg>
  );
}
