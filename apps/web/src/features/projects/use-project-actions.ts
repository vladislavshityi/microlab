import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteProject } from "@/api/projects";
import { useProjectStore } from "@/stores/project-store";
import { useUiStore } from "@/stores/ui-store";

import {
  createAndOpenProject,
  openAfterDeletion,
  reloadFromServer,
  saveAsNewProject,
  switchToProject,
} from "./project-session";

/**
 * Действия с проектами как мутации TanStack Query: после каждой список проектов
 * в кэше помечается устаревшим. Сбой показывается уведомлением в строке состояния.
 */
export function useProjectActions() {
  const queryClient = useQueryClient();
  const showNotice = useUiStore((state) => state.showNotice);
  const common = {
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["projects", "list"] }),
    onError: () => {
      showNotice("projects.notice.actionFailed");
    },
  };

  const open = useMutation({
    mutationFn: async (id: string) => {
      const opened = await switchToProject(id);
      if (!opened && useProjectStore.getState().phase === "ready") {
        showNotice("projects.notice.unsavedBlocked");
      }
      return opened;
    },
    ...common,
  });
  const create = useMutation({ mutationFn: () => createAndOpenProject(), ...common });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteProject(id);
      if (useProjectStore.getState().projectId === id) {
        await openAfterDeletion();
      }
    },
    ...common,
  });
  const reload = useMutation({ mutationFn: () => reloadFromServer(), ...common });
  const saveCopy = useMutation({ mutationFn: () => saveAsNewProject(), ...common });

  return { open, create, remove, reload, saveCopy };
}
