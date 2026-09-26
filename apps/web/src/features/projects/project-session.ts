import type { CircuitDocument, ProjectTemplate } from "@microlab/circuit-schema";

import {
  createProject,
  getProject,
  getRevision,
  listProjects,
  ProjectApiError,
  updateProject,
} from "@/api/projects";
import type { ProjectDetail } from "@/api/schemas";
import {
  CircuitDocumentError,
  normalizeCircuit,
  parseCircuitDocument,
} from "@/features/circuit-model/circuit-document";
import { localized } from "@/i18n/localized";
import { t } from "@/i18n/t";
import { readStorage, writeStorage } from "@/lib/storage";
import { useCircuitStore } from "@/stores/circuit-store";
import { useEditorStore } from "@/stores/editor-store";
import {
  hasUnsavedChanges,
  useProjectStore,
  type LoadErrorKind,
  type SaveErrorKind,
} from "@/stores/project-store";

/** Задержка автосохранения после последнего изменения, мс. */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/** Задержки повторов при временных сбоях сохранения, мс (последняя повторяется). */
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000] as const;

/** Ключ localStorage с id последнего открытого проекта (удобство для этого браузера). */
export const LAST_PROJECT_KEY = "microlab.project.last";

/**
 * Сессия проекта: открытие проекта в рабочий документ, отслеживание изменений,
 * автосохранение с оптимистичной блокировкой и повторами.
 *
 * Изменения считаются счётчиком: `changeSeq` растёт при каждом изменении кода, схемы или
 * имени, `savedSeq` — номер изменения, вошедшего в последнее успешное сохранение. Документ
 * сохранён, когда они равны. Сохранение отправляет весь документ и номер версии, на которой
 * он основан; сервер отвечает конфликтом, если проект изменили в другом месте, и тогда
 * автосохранение останавливается до решения пользователя — данные никогда не
 * перезаписываются молча.
 */
let changeSeq = 0;
let savedSeq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<boolean> | null = null;
let retryAttempt = 0;
/** Растёт при открытии проекта: ответы на запросы для прежнего проекта игнорируются. */
let generation = 0;
/** Изменения хранилищ во время открытия проекта — не правки пользователя. */
let loading = false;

function cancelTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function schedule(delayMs: number): void {
  cancelTimer();
  timer = setTimeout(() => {
    timer = null;
    void saveNow();
  }, delayMs);
}

function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? AUTOSAVE_DEBOUNCE_MS;
}

/** Сбрасывает состояние модуля (тесты). */
export function resetProjectSession(): void {
  cancelTimer();
  changeSeq = 0;
  savedSeq = 0;
  inFlight = null;
  retryAttempt = 0;
  generation += 1;
  loading = false;
}

function loadErrorKind(error: unknown): LoadErrorKind {
  if (error instanceof CircuitDocumentError) {
    return error.code === "UNSUPPORTED_SCHEMA_VERSION" ? "unsupportedVersion" : "invalidDocument";
  }
  if (error instanceof ProjectApiError) {
    if (error.code === "PROJECT_NOT_FOUND") return "notFound";
    return error.retryable ? "network" : "server";
  }
  return "server";
}

/** Показывает ошибку открытия проекта; рабочий документ при этом не сохраняется. */
export function failLoading(error: unknown): void {
  cancelTimer();
  generation += 1;
  useProjectStore.setState({ phase: "loadError", loadError: loadErrorKind(error) });
}

/**
 * Загружает проект в рабочий документ. Схема разбирается с проверкой schemaVersion; если
 * документ не разобран, рабочий документ не меняется и показывается ошибка. История
 * отмены схемы и редактора кода сбрасывается.
 */
export function openProject(project: ProjectDetail): boolean {
  // Чужой проект (преподаватель, администратор) открывается только для просмотра.
  const readOnly = project.access === "viewer";
  let circuit: CircuitDocument;
  try {
    circuit = parseCircuitDocument(project.circuit);
    normalizeCircuit(circuit);
  } catch (error) {
    failLoading(error);
    return false;
  }
  cancelTimer();
  generation += 1;
  loading = true;
  try {
    useCircuitStore.getState().setReadOnly(readOnly);
    useEditorStore.setState({ readOnly });
    useCircuitStore.getState().loadDocument(circuit);
    useEditorStore.getState().loadCode(project.code);
  } finally {
    loading = false;
  }
  changeSeq = 0;
  savedSeq = 0;
  retryAttempt = 0;
  inFlight = null;
  useProjectStore.setState({
    phase: "ready",
    loadError: null,
    projectId: project.id,
    name: project.name,
    revision: project.revision,
    status: "saved",
    errorKind: null,
    conflict: null,
    readOnly: readOnly ? { ownerName: project.owner.displayName } : null,
  });
  if (!readOnly) writeStorage(LAST_PROJECT_KEY, project.id);
  return true;
}

/** Отмечает изменение рабочего документа и планирует автосохранение. */
function markChanged(): void {
  const state = useProjectStore.getState();
  if (loading || state.phase !== "ready" || state.readOnly !== null) return;
  changeSeq += 1;
  if (state.status === "conflict") return;
  if (state.status !== "saving") {
    useProjectStore.setState({ status: "dirty", errorKind: null });
  }
  schedule(AUTOSAVE_DEBOUNCE_MS);
}

function saveFailed(errorKind: SaveErrorKind, retry: boolean): void {
  useProjectStore.setState({ status: "error", errorKind });
  if (retry) {
    schedule(retryDelay(retryAttempt));
    retryAttempt += 1;
  }
}

async function performSave(): Promise<boolean> {
  const state = useProjectStore.getState();
  if (state.phase !== "ready" || state.projectId === null || state.status === "conflict") {
    return false;
  }
  if (state.readOnly !== null) return true;
  if (changeSeq === savedSeq) {
    if (state.status !== "saved") useProjectStore.setState({ status: "saved", errorKind: null });
    return true;
  }
  const currentGeneration = generation;
  const seq = changeSeq;
  const patch = {
    revision: state.revision,
    name: state.name,
    code: useEditorStore.getState().code,
    circuit: useCircuitStore.getState().serialize(),
  };
  useProjectStore.setState({ status: "saving" });
  try {
    const saved = await updateProject(state.projectId, patch);
    if (currentGeneration !== generation) return false;
    savedSeq = seq;
    retryAttempt = 0;
    const dirty = changeSeq !== savedSeq;
    useProjectStore.setState({
      revision: saved.revision,
      status: dirty ? "dirty" : "saved",
      errorKind: null,
    });
    if (dirty) schedule(AUTOSAVE_DEBOUNCE_MS);
    return !dirty;
  } catch (error) {
    if (currentGeneration !== generation) return false;
    if (!(error instanceof ProjectApiError)) {
      saveFailed("server", false);
      throw error;
    }
    if (error.code === "REVISION_CONFLICT") {
      cancelTimer();
      useProjectStore.setState({ status: "conflict", conflict: "revision", errorKind: null });
    } else if (error.code === "PROJECT_NOT_FOUND") {
      cancelTimer();
      useProjectStore.setState({ status: "conflict", conflict: "deleted", errorKind: null });
    } else if (error.retryable) {
      saveFailed("network", true);
    } else if (error.status === 413 || error.status === 422) {
      // Документ отклонён сервером: повтор без изменений не поможет, следующая правка
      // или Cmd/Ctrl+S попробует снова.
      saveFailed("invalid", false);
    } else {
      saveFailed("server", false);
    }
    return false;
  }
}

/**
 * Сохраняет рабочий документ сейчас (Cmd/Ctrl+S, кнопка «Сохранить», переключение
 * проекта). Возвращает true, если после завершения все изменения сохранены.
 */
export function saveNow(): Promise<boolean> {
  cancelTimer();
  if (inFlight !== null) {
    // Дождаться текущего запроса, затем сохранить изменения, сделанные во время него.
    return inFlight.then(() => saveNow());
  }
  const request = performSave().finally(() => {
    if (inFlight === request) inFlight = null;
  });
  inFlight = request;
  return request;
}

/** Переименовывает открытый проект; пустое имя игнорируется. */
export function renameProject(name: string): void {
  const trimmed = name.trim();
  const state = useProjectStore.getState();
  if (trimmed === "" || trimmed === state.name || state.phase !== "ready") return;
  useProjectStore.setState({ name: trimmed });
  markChanged();
  void saveNow();
}

/**
 * Перед уходом с проекта: сохраняет изменения. false — сохранить не удалось, и уходить
 * нельзя без потери данных.
 */
export async function flushBeforeLeave(): Promise<boolean> {
  const state = useProjectStore.getState();
  if (state.phase !== "ready") return true;
  if (!hasUnsavedChanges(state)) return true;
  if (state.status === "conflict") return false;
  return saveNow();
}

/** Открывает проект по id (после сохранения текущего). */
export async function switchToProject(id: string): Promise<boolean> {
  if (!(await flushBeforeLeave())) return false;
  return openProject(await getProject(id));
}

/** Создаёт проект и открывает его (после сохранения текущего). */
export async function createAndOpenProject(template?: ProjectTemplate): Promise<boolean> {
  if (!(await flushBeforeLeave())) return false;
  const data =
    template === undefined
      ? { name: t("projects.defaultName") }
      : { name: localized(template.name), code: template.code, circuit: template.circuit };
  return openProject(await createProject(data));
}

/** Проект с последнего запуска, иначе последний изменённый, иначе новый. */
export async function resolveStartupProject(signal?: AbortSignal): Promise<ProjectDetail> {
  const lastId = readStorage(LAST_PROJECT_KEY);
  if (lastId !== null && lastId !== "") {
    try {
      return await getProject(lastId, signal);
    } catch (error) {
      // Проект удалён: открываем другой. Остальные ошибки показываются пользователю.
      if (!(error instanceof ProjectApiError && error.code === "PROJECT_NOT_FOUND")) throw error;
    }
  }
  const [latest] = await listProjects(signal);
  if (latest !== undefined) {
    return getProject(latest.id, signal);
  }
  return createProject({ name: t("projects.defaultName") }, signal);
}

/** После удаления открытого проекта: открыть другой или создать новый. */
export async function openAfterDeletion(): Promise<void> {
  generation += 1;
  cancelTimer();
  const [latest] = await listProjects();
  const project =
    latest === undefined
      ? await createProject({ name: t("projects.defaultName") })
      : await getProject(latest.id);
  openProject(project);
}

/**
 * Восстанавливает сохранённую версию: её код и схема сохраняются как новая версия проекта
 * (история не переписывается). Текущие изменения сначала сохраняются.
 */
export async function restoreRevision(revision: number): Promise<boolean> {
  const state = useProjectStore.getState();
  if (state.projectId === null || state.readOnly !== null) return false;
  if (!(await flushBeforeLeave())) return false;
  const { projectId } = state;
  const snapshot = await getRevision(projectId, revision);
  // Схема старой версии проверяется до записи: неподдерживаемый документ не восстанавливается.
  parseCircuitDocument(snapshot.circuit);
  const saved = await updateProject(projectId, {
    revision: useProjectStore.getState().revision,
    code: snapshot.code,
    circuit: snapshot.circuit as unknown as CircuitDocument,
  });
  return openProject(saved);
}

/** Конфликт: отбросить локальные изменения и загрузить версию с сервера. */
export async function reloadFromServer(): Promise<boolean> {
  const { projectId } = useProjectStore.getState();
  if (projectId === null) return false;
  return openProject(await getProject(projectId));
}

/** Конфликт или удалённый проект: сохранить рабочий документ как новый проект. */
export async function saveAsNewProject(): Promise<boolean> {
  const state = useProjectStore.getState();
  const created = await createProject({
    name: t("projects.copyName", { name: state.name }),
    code: useEditorStore.getState().code,
    circuit: useCircuitStore.getState().serialize(),
  });
  return openProject(created);
}

/**
 * Подписывает сессию на изменения рабочего документа и предупреждает о несохранённых
 * изменениях при закрытии вкладки. Возвращает функцию отписки.
 */
export function startProjectSession(): () => void {
  const unsubscribeCircuit = useCircuitStore.subscribe((state, previous) => {
    if (
      state.board !== previous.board ||
      state.components !== previous.components ||
      state.componentOrder !== previous.componentOrder ||
      state.connections !== previous.connections ||
      state.connectionOrder !== previous.connectionOrder
    ) {
      markChanged();
    }
  });
  const unsubscribeEditor = useEditorStore.subscribe((state, previous) => {
    if (state.code !== previous.code) markChanged();
  });
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    const state = useProjectStore.getState();
    if (state.phase === "ready" && hasUnsavedChanges(state)) {
      event.preventDefault();
    }
  };
  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => {
    unsubscribeCircuit();
    unsubscribeEditor();
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}
