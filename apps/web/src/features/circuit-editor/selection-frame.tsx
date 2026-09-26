import { memo } from "react";

/** Отступ рамки от символа, px (в координатах холста). */
const GAP = 3;

/**
 * Рамка выделения и фокуса — векторные линии поверх символа. Толщина не зависит от
 * масштаба (non-scaling-stroke), а сама рамка не создаёт растровых эффектов (теней,
 * фильтров, трансформаций), поэтому символ остаётся чётким при любом масштабе.
 * Рамка фокуса показывается через CSS (:focus-visible узла).
 */
export const SelectionFrame = memo(function SelectionFrame({
  width,
  height,
  selected,
}: {
  width: number;
  height: number;
  selected: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={width}
      height={height}
    >
      {selected && (
        <rect
          x={-GAP}
          y={-GAP}
          width={width + GAP * 2}
          height={height + GAP * 2}
          fill="none"
          stroke="var(--ring)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      <rect
        className="circuit-focus-frame"
        x={-GAP * 2}
        y={-GAP * 2}
        width={width + GAP * 4}
        height={height + GAP * 4}
        fill="none"
        stroke="var(--ring)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});
