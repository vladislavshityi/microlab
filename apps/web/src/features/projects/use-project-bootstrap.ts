import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useProjectStore } from "@/stores/project-store";

import { getProject } from "@/api/projects";

import { failLoading, openProject, resolveStartupProject, startProjectSession } from "./project-session";

export const STARTUP_PROJECT_KEY = ["projects", "startup"] as const;

/**
 * При запуске приложения открывает проект (последний открытый, иначе последний изменённый,
 * иначе новый) и подключает автосохранение. `viewProjectId` — открыть указанный проект
 * (чужой проект открывается только для просмотра).
 */
export function useProjectBootstrap(viewProjectId?: string) {
  useEffect(() => startProjectSession(), []);

  const query = useQuery({
    queryKey: viewProjectId === undefined ? STARTUP_PROJECT_KEY : [...STARTUP_PROJECT_KEY, viewProjectId],
    queryFn: ({ signal }) =>
      viewProjectId === undefined ? resolveStartupProject(signal) : getProject(viewProjectId, signal),
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const { data, error } = query;
  useEffect(() => {
    // Открываем только в начальном состоянии: повторный рендер не должен заменять документ.
    if (useProjectStore.getState().projectId !== null) return;
    if (data !== undefined) {
      openProject(data);
    } else if (error !== null) {
      failLoading(error);
    }
  }, [data, error]);

  return query;
}
