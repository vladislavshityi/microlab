import { memo, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useReactFlow, type EdgeProps } from "@xyflow/react";
import type { BoardInstance, ComponentInstance, GridPoint, PinRef } from "@microlab/circuit-schema";

import {
  getPinIndex,
  JUNCTION_MIN_ENDPOINTS,
  pinKey,
} from "@/features/circuit-model/connection-rules";
import { GRID_PX, resolveInstancePin } from "@/features/circuit-model/geometry";
import { moveSegment, segments, wirePolyline } from "@/features/circuit-model/routing";
import { t } from "@/i18n/t";
import { useCircuitStore } from "@/stores/circuit-store";

import type { WireFlowEdge } from "./flow-model";
import { DEFAULT_WIRE_COLOR } from "./wire-colors";

type CircuitStoreState = ReturnType<typeof useCircuitStore.getState>;

function selectSource(
  state: CircuitStoreState,
  componentId: string | undefined,
): ComponentInstance | BoardInstance | undefined {
  if (componentId === undefined) return undefined;
  return componentId === state.board.id ? state.board : state.components[componentId];
}

/** Рисует ли этот провод точку соединения на выводе (одна точка на вывод). */
function ownsJunction(state: CircuitStoreState, connectionId: string, pin: PinRef | undefined): boolean {
  if (pin === undefined) return false;
  const ids = getPinIndex(state.connections, state.connectionOrder).get(pinKey(pin));
  return ids !== undefined && ids.length >= JUNCTION_MIN_ENDPOINTS && ids[0] === connectionId;
}

function toPath(points: readonly GridPoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x * GRID_PX} ${point.y * GRID_PX}`).join(" ");
}

/** Размер ручки перетаскивания отрезка, px. */
const SEGMENT_HANDLE_PX = 8;

/**
 * Провод: ортогональная ломаная между выводами по данным Circuit Model. Выделенный
 * провод показывает ручки отрезков — перетаскивание сдвигает отрезок по сетке и
 * сохраняет промежуточные точки трассы.
 */
export const WireEdge = memo(function WireEdge({ id, selected }: EdgeProps<WireFlowEdge>) {
  const connection = useCircuitStore((state) => state.connections[id]);
  const fromSource = useCircuitStore((state) => selectSource(state, connection?.from.componentId));
  const toSource = useCircuitStore((state) => selectSource(state, connection?.to.componentId));
  const junctionFrom = useCircuitStore((state) => ownsJunction(state, id, connection?.from));
  const junctionTo = useCircuitStore((state) => ownsJunction(state, id, connection?.to));
  const { screenToFlowPosition } = useReactFlow();
  const dragRef = useRef<{ cleanup: () => void } | null>(null);

  const points = useMemo(() => {
    if (connection === undefined || fromSource === undefined || toSource === undefined) return null;
    const from = resolveInstancePin(fromSource, connection.from.pinId);
    const to = resolveInstancePin(toSource, connection.to.pinId);
    if (from === undefined || to === undefined) return null;
    return wirePolyline(from.point, from.direction, to.point, to.direction, connection.route);
  }, [connection, fromSource, toSource]);

  if (connection === undefined || points === null) {
    return null;
  }
  const path = toPath(points);
  const color = connection.color ?? DEFAULT_WIRE_COLOR;
  const first = points[0];
  const last = points.at(-1);

  const startSegmentDrag = (index: number, horizontal: boolean, event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    dragRef.current?.cleanup();
    const store = useCircuitStore.getState();
    const basePoints = points;
    const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    store.beginGesture();
    const onMove = (moveEvent: PointerEvent) => {
      const current = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      const delta = Math.round(
        horizontal ? (current.y - start.y) / GRID_PX : (current.x - start.x) / GRID_PX,
      );
      const route = moveSegment(basePoints, index, delta);
      if (route !== null) {
        useCircuitStore.getState().setConnectionRoute(id, route);
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragRef.current = null;
    };
    const onUp = () => {
      cleanup();
      useCircuitStore.getState().endGesture();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    dragRef.current = { cleanup };
  };

  return (
    <g className="circuit-wire">
      {selected === true && (
        <path d={path} fill="none" stroke="var(--ring)" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" />
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={selected === true ? 3 : 2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path d={path} fill="none" stroke="transparent" strokeWidth={12} className="circuit-wire-hit" />
      {junctionFrom && first !== undefined && (
        <circle cx={first.x * GRID_PX} cy={first.y * GRID_PX} r={3.5} fill={color} stroke="var(--background)" strokeWidth={1.5} />
      )}
      {junctionTo && last !== undefined && (
        <circle cx={last.x * GRID_PX} cy={last.y * GRID_PX} r={3.5} fill={color} stroke="var(--background)" strokeWidth={1.5} />
      )}
      {selected === true &&
        segments(points).map((segment, index) => {
          const horizontal = segment.from.y === segment.to.y;
          const length = Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y);
          if (length < 1) return null;
          const cx = ((segment.from.x + segment.to.x) / 2) * GRID_PX;
          const cy = ((segment.from.y + segment.to.y) / 2) * GRID_PX;
          return (
            <rect
              key={index}
              className="circuit-wire-segment-handle nodrag nopan"
              x={cx - SEGMENT_HANDLE_PX / 2}
              y={cy - SEGMENT_HANDLE_PX / 2}
              width={SEGMENT_HANDLE_PX}
              height={SEGMENT_HANDLE_PX}
              rx={1.5}
              fill="var(--background)"
              stroke="var(--ring)"
              strokeWidth={1.5}
              style={{ cursor: horizontal ? "ns-resize" : "ew-resize" }}
              onPointerDown={(event) => {
                startSegmentDrag(index, horizontal, event);
              }}
            >
              <title>{t("canvas.wire.dragSegment")}</title>
            </rect>
          );
        })}
    </g>
  );
});
