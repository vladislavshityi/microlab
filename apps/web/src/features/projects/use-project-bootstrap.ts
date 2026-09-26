import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useProjectStore } from "@/stores/project-store";

import { failLoading, openProject, resolveStartupProject, startProjectSession } from "./project-session";

export const STARTUP_PROJECT_KEY = ["projects", "startup"] as const;

/**
 * При запуске приложения открывает проект (последний открытый, иначе последний изменённый,
 * иначе новый) и подключает автосохранение.
 */
export function useProjectBootstrap() {
  useEffect(() => startProjectSession(), []);

  const query = useQuery({
    queryKey: STARTUP_PROJECT_KEY,
    queryFn: ({ signal }) => resolveStartupProject(signal),
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
