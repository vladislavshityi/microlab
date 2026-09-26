import { useEffect } from "react";

import { simulationEventsUrl } from "@/api/simulation";
import { useProjectStore } from "@/stores/project-store";
import { useSimulationStore } from "@/stores/simulation-store";

import { parseStreamMessage } from "./events";

/** Задержки переподключения, мс (последняя повторяется). */
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000] as const;

/** Коды закрытия, после которых переподключение бессмысленно (проект не найден, нет доступа). */
const FINAL_CLOSE_CODES: ReadonlySet<number> = new Set([1008, 4401, 4404]);

type SocketFactory = (url: string) => WebSocket;

/**
 * Подключение к потоку событий симуляции проекта с переподключением. Каждое сообщение —
 * одно обновление simulationStore. Возвращает функцию отключения.
 */
export function connectSimulationStream(
  projectId: string,
  createSocket: SocketFactory = (url) => new WebSocket(url),
): () => void {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let closed = false;

  const connect = () => {
    const ws = createSocket(simulationEventsUrl(projectId, window.location));
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = (event: MessageEvent) => {
      const message = parseStreamMessage(event.data);
      if (message !== null) useSimulationStore.getState().applyMessage(message);
    };
    ws.onclose = (event: CloseEvent) => {
      socket = null;
      if (closed || FINAL_CLOSE_CODES.has(event.code)) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 5000;
      attempt += 1;
      timer = setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    socket?.close(1000);
  };
}

/** Поток событий открытого проекта; при смене проекта состояние симуляции сбрасывается. */
export function useSimulationStream(): void {
  const projectId = useProjectStore((state) => (state.phase === "ready" ? state.projectId : null));
  useEffect(() => {
    useSimulationStore.getState().resetForProject();
    if (projectId === null || typeof WebSocket === "undefined") return undefined;
    return connectSimulationStream(projectId);
  }, [projectId]);
}
