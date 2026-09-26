import { create } from "zustand";

/**
 * Состояние сохранения рабочего документа:
 * - `saved` — всё сохранено на сервере;
 * - `dirty` — есть несохранённые изменения (сохранение запланировано);
 * - `saving` — идёт запрос сохранения;
 * - `error` — сохранить не удалось (при сетевой ошибке выполняется повтор);
 * - `conflict` — проект изменён в другом месте или удалён; автосохранение остановлено
 *   до решения пользователя.
 */
export type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

/** Причина ошибки сохранения (для текста в интерфейсе). */
export type SaveErrorKind = "network" | "invalid" | "server";

/** Причина остановки автосохранения. */
export type ConflictKind = "revision" | "deleted";

/** Причина, по которой проект не удалось открыть. */
export type LoadErrorKind =
  | "network"
  | "invalidDocument"
  | "unsupportedVersion"
  | "notFound"
  | "server";

export type ProjectPhase = "loading" | "ready" | "loadError";

interface ProjectState {
  phase: ProjectPhase;
  loadError: LoadErrorKind | null;
  /** Открытый проект; null, пока проект не загружен. */
  projectId: string | null;
  name: string;
  /** Версия проекта на сервере, на которой основан рабочий документ. */
  revision: number;
  status: SaveStatus;
  errorKind: SaveErrorKind | null;
  conflict: ConflictKind | null;
  /** Чужой проект открыт только для просмотра (владелец — `ownerName`); автосохранения нет. */
  readOnly: { ownerName: string } | null;
}

/**
 * Рабочий документ проекта: какой проект открыт, его имя и состояние сохранения.
 * Код и схема живут в editorStore и circuitStore; серверные данные (список проектов)
 * — в кэше TanStack Query. Изменяется только через сессию проекта (features/projects).
 */
export const useProjectStore = create<ProjectState>()(() => ({
  phase: "loading",
  loadError: null,
  projectId: null,
  name: "",
  revision: 0,
  status: "saved",
  errorKind: null,
  conflict: null,
  readOnly: null,
}));

/** Есть изменения, которые ещё не сохранены на сервере. */
export function hasUnsavedChanges(state: Pick<ProjectState, "status">): boolean {
  return state.status !== "saved";
}
