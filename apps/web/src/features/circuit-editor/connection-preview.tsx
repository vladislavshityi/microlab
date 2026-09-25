import { useEffect, useMemo, useState } from "react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";

import { pinKey } from "@/features/circuit-model/connection-rules";
import { GRID_PX, resolveInstancePin, worldToGrid } from "@/features/circuit-model/geometry";
import { autoRoute } from "@/features/circuit-model/routing";
import { useCircuitStore } from "@/stores/circuit-store";

/**
 * Предпросмотр прокладываемого провода: ортогональная пунктирная линия от начального
 * вывода до ближайшего к курсору узла сетки. Координаты курсора — локальное состояние,
 * в Circuit Model ничего не записывается до завершения соединения.
 */
export function ConnectionPreview() {
  const pending = useCircuitStore((state) => state.pendingConnection);
  const source = useCircuitStore((state) =>
    pending === null
      ? undefined
      : pending.componentId === state.board.id
        ? state.board
        : state.components[pending.componentId],
  );
  const origin = useMemo(
    () => (pending === null || source === undefined ? undefined : resolveInstancePin(source, pending.pinId)),
    [pending, source],
  );
  const { screenToFlowPosition } = useReactFlow();
  // Курсор запоминается вместе с ключом вывода: после смены вывода старая точка не используется.
  const [cursor, setCursor] = useState<{ pin: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (pending === null) {
      return undefined;
    }
    const key = pinKey(pending);
    const onMove = (event: PointerEvent) => {
      setCursor({ pin: key, ...screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
    };
  }, [pending, screenToFlowPosition]);

  if (pending === null || origin === undefined || cursor?.pin !== pinKey(pending)) {
    return null;
  }
  const target = worldToGrid(cursor);
  const points = autoRoute(origin.point, origin.direction, target, null);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x * GRID_PX} ${point.y * GRID_PX}`)
    .join(" ");
  return (
    <ViewportPortal>
      <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden="true">
        <path d={path} fill="none" stroke="var(--ring)" strokeWidth={2} strokeDasharray="5 4" />
      </svg>
    </ViewportPortal>
  );
}
