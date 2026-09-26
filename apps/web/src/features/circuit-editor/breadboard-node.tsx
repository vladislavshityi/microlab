import { memo, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Handle, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import type { ComponentDefinition } from "@microlab/circuit-schema";

import { GRID_PX, rotatedSize } from "@/features/circuit-model/geometry";
import { useCircuitStore } from "@/stores/circuit-store";

import {
  holeAtClientPoint,
  holeClientRect,
  holePath,
  occupiedHoles,
  socketLayout,
  wireEndHoles,
} from "./breadboard";
import { usePinActions } from "./canvas-context";
import { pinLayouts, type CircuitFlowNode } from "./flow-model";
import { rotationTransform } from "./rotation";
import { SelectionFrame } from "./selection-frame";

/** Цвет линии шины: «+» (p) — красный, «−» (n) — синий. Только визуальная пометка. */
const RAIL_COLORS: Readonly<Record<string, string>> = { p: "#dc2626", n: "#2563eb" };

interface BoardArtProps {
  definition: ComponentDefinition;
  occupied: string;
  hoveredGroup: readonly string[] | null;
  pendingPin: string | null;
}

function groupBounds(definition: ComponentDefinition, group: readonly string[]) {
  const points = group.flatMap((pinId) => definition.visual.pins[pinId] ?? []);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** Корпус, шины, подписи и отверстия; рисуется в локальных координатах без поворота. */
const BoardArt = memo(function BoardArt({ definition, occupied, hoveredGroup, pendingPin }: BoardArtProps) {
  const { width, height } = definition.visual;
  const layout = socketLayout(definition, 0);
  const pins = definition.visual.pins;

  const rails = useMemo(
    () =>
      (definition.internalConnections ?? [])
        .filter((group) => /^[tb][pn]/.test(group[0]))
        .map((group) => ({ id: group[0], polarity: group[0].charAt(1), ...groupBounds(definition, group) })),
    [definition],
  );
  const labels = useMemo(() => {
    const rows = new Map<string, number>();
    const columns = new Map<number, number>();
    for (const pin of definition.pins) {
      const match = /^([a-j])(\d+)$/.exec(pin.id);
      const point = pins[pin.id];
      if (match?.[1] === undefined || match[2] === undefined || point === undefined) continue;
      rows.set(match[1], point.y);
      columns.set(Number(match[2]), point.x);
    }
    return { rows: [...rows], columns: [...columns].filter(([column]) => column === 1 || column % 5 === 0) };
  }, [definition, pins]);
  const trench = useMemo(() => {
    const e = pins["e1"];
    const f = pins["f1"];
    return e === undefined || f === undefined ? null : { y: (e.y + f.y) / 2 };
  }, [pins]);

  const occupiedPath = useMemo(
    () =>
      occupied
        .split(" ")
        .flatMap((pinId) => {
          const point = pins[pinId];
          return point === undefined ? [] : [holePath(point, 0.2)];
        })
        .join(""),
    [occupied, pins],
  );
  const pendingPoint = pendingPin === null ? undefined : pins[pendingPin];
  const hovered = hoveredGroup === null ? null : groupBounds(definition, hoveredGroup);

  return (
    <>
      <rect x={0.3} y={0.25} width={width - 0.6} height={height - 0.5} rx={0.35} fill="var(--card)" stroke="var(--border)" strokeWidth={0.08} />
      {trench !== null && (
        <rect x={0.8} y={trench.y - 0.35} width={width - 1.6} height={0.7} rx={0.2} fill="var(--muted)" />
      )}
      {/* Линия шины снаружи пары: «+» дальше от центра платы сверху и снизу. */}
      {rails.map((rail) => (
        <line
          key={rail.id}
          x1={rail.x1 - 0.5}
          x2={rail.x2 + 0.5}
          y1={rail.y1 + (rail.y1 < height / 2 ? -0.45 : 0.45) * (rail.polarity === "p" ? 1 : -1)}
          y2={rail.y1 + (rail.y1 < height / 2 ? -0.45 : 0.45) * (rail.polarity === "p" ? 1 : -1)}
          stroke={RAIL_COLORS[rail.polarity]}
          strokeWidth={0.07}
        />
      ))}
      {labels.rows.map(([row, y]) => (
        <g key={row} fontSize={0.5} fill="var(--muted-foreground)" fontFamily="var(--font-code)" textAnchor="middle">
          <text x={0.95} y={y + 0.17}>{row}</text>
          <text x={width - 0.95} y={y + 0.17}>{row}</text>
        </g>
      ))}
      {labels.columns.map(([column, x]) => (
        <text key={column} x={x} y={3.3} fontSize={0.45} textAnchor="middle" fill="var(--muted-foreground)" fontFamily="var(--font-code)">
          {column}
        </text>
      ))}
      {hovered !== null && (
        <rect
          x={hovered.x1 - 0.4}
          y={hovered.y1 - 0.4}
          width={hovered.x2 - hovered.x1 + 0.8}
          height={hovered.y2 - hovered.y1 + 0.8}
          rx={0.3}
          fill="color-mix(in oklab, var(--ring) 18%, transparent)"
          stroke="var(--ring)"
          strokeWidth={0.08}
        />
      )}
      <path d={layout.holesPath} fill="var(--muted-foreground)" fillOpacity={0.55} />
      {occupiedPath !== "" && <path d={occupiedPath} fill="var(--foreground)" />}
      {pendingPoint !== undefined && (
        <circle cx={pendingPoint.x} cy={pendingPoint.y} r={0.38} fill="none" stroke="var(--ring)" strokeWidth={0.1} />
      )}
    </>
  );
});

/**
 * Невидимые DOM-выводы только для отверстий, к которым подходят провода: React Flow
 * измеряет выводы узла по DOM, и без них провод к отверстию не строится. Остальные
 * отверстия DOM-элементов не имеют.
 */
const WireEndHandles = memo(function WireEndHandles({
  componentId,
  definition,
  rotation,
  pinIds,
}: {
  componentId: string;
  definition: ComponentDefinition;
  rotation: CircuitFlowNode["data"]["rotation"];
  pinIds: string;
}) {
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(componentId);
  }, [componentId, pinIds, rotation, updateNodeInternals]);
  if (pinIds === "") return null;
  const wanted = new Set(pinIds.split(" "));
  return pinLayouts(definition, rotation)
    .filter((layout) => wanted.has(layout.id))
    .map((layout) => (
      <Handle
        key={layout.id}
        id={layout.id}
        type="source"
        position={layout.position}
        isConnectable={false}
        className="circuit-wire-end"
        style={{ left: layout.x, top: layout.y }}
      />
    ));
});

/**
 * Макетная плата на холсте: одна SVG-картинка вместо элемента на каждое отверстие.
 * Наведение подсвечивает всю полосу (узел) отверстия; щелчок или перетаскивание от
 * отверстия начинает провод, как от обычного вывода.
 */
export const BreadboardNode = memo(function BreadboardNode({ data, selected }: NodeProps<CircuitFlowNode>) {
  const { componentId, definition, rotation } = data;
  const actions = usePinActions();
  const occupied = useCircuitStore((state) => occupiedHoles(state).get(componentId) ?? "");
  const pendingPin = useCircuitStore((state) =>
    state.pendingConnection?.componentId === componentId ? state.pendingConnection.pinId : null,
  );
  const wireEnds = useCircuitStore((state) => wireEndHoles(state, componentId));
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);
  const layout = socketLayout(definition, rotation);
  const size = rotatedSize(definition.visual, rotation);

  const holeFromEvent = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pinId = holeAtClientPoint(definition, rotation, rect, event.clientX, event.clientY);
    return pinId === undefined ? null : { pinId, rect };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const hit = holeFromEvent(event);
    if (hit?.pinId === hoveredPin) return;
    setHoveredPin(hit?.pinId ?? null);
    const hintRect = hit === null ? undefined : holeClientRect(definition, rotation, hit.pinId, hit.rect);
    if (hit === null || hintRect === undefined) {
      actions.hidePinHint();
    } else {
      actions.showPinHint({ componentId, pinId: hit.pinId }, hintRect);
    }
  };

  const onPointerLeave = () => {
    setHoveredPin(null);
    actions.hidePinHint();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const hit = holeFromEvent(event);
    if (hit === null) return;
    // Отмена действия по умолчанию подавляет mousedown: плата не начинает перетаскиваться.
    event.preventDefault();
    actions.onPinPointerDown({ componentId, pinId: hit.pinId }, event);
  };

  return (
    <div
      className="circuit-node circuit-breadboard-holes relative"
      style={{ width: size.width * GRID_PX, height: size.height * GRID_PX }}
      data-breadboard-component={componentId}
      data-breadboard-rotation={rotation}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
    >
      <svg
        aria-hidden="true"
        width={size.width * GRID_PX}
        height={size.height * GRID_PX}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="block"
      >
        <g transform={rotationTransform(rotation, definition.visual.width, definition.visual.height)}>
          <BoardArt
            definition={definition}
            occupied={occupied}
            hoveredGroup={hoveredPin === null ? null : (layout.groupOf.get(hoveredPin) ?? [hoveredPin])}
            pendingPin={pendingPin}
          />
        </g>
      </svg>
      <SelectionFrame width={size.width * GRID_PX} height={size.height * GRID_PX} selected={selected} />
      <WireEndHandles componentId={componentId} definition={definition} rotation={rotation} pinIds={wireEnds} />
    </div>
  );
});
