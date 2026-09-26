import {
  sendSerialInput,
  sendSimulationCommand,
  setComponentInput,
  SimulationApiError,
  startSimulation,
  type SimulationCommand,
} from "@/api/simulation";
import { flushBeforeLeave } from "@/features/projects/project-session";
import type { TranslationKey } from "@/i18n/t";
import { useProjectStore } from "@/stores/project-store";
import { ACTIVE_PHASES, PENDING_PHASES, useSimulationStore } from "@/stores/simulation-store";
import { useUiStore } from "@/stores/ui-store";

/**
 * Действия симуляции: запуск (сохранение → проверка схемы и компиляция на сервере →
 * сессия), управление сессией и входы компонентов. Состояние сессии приходит потоком
 * событий; ответы команд дополнительно синхронизируют фазу, если поток прервался.
 */

function errorKey(error: unknown): TranslationKey {
  if (!(error instanceof SimulationApiError)) return "console.run.failed";
  if (error.kind === "unreachable") return "console.run.unreachable";
  switch (error.code) {
    case "CIRCUIT_HAS_ERRORS":
      return "console.run.circuitErrors";
    case "COMPILATION_FAILED":
      return "console.run.compileFailed";
    case "SIMULATOR_UNAVAILABLE":
      return "console.run.simulatorUnavailable";
    case "SIMULATOR_BUSY":
      return "console.run.simulatorBusy";
    case "COMPILER_UNAVAILABLE":
    case "COMPILER_BUSY":
    case "COMPILATION_TIMEOUT":
      return "console.run.compilerUnavailable";
    default:
      return "console.run.failed";
  }
}

function currentProjectId(): string | null {
  const project = useProjectStore.getState();
  return project.phase === "ready" ? project.projectId : null;
}

/** Запуск: Cmd/Ctrl+Enter и кнопка «Запуск». Во время запуска повторный вызов игнорируется. */
export async function runSimulation(): Promise<void> {
  const projectId = currentProjectId();
  const store = useSimulationStore.getState();
  if (projectId === null || PENDING_PHASES.has(store.phase)) return;
  if (useProjectStore.getState().readOnly !== null) return;
  store.beginRun();
  // Сервер проверяет и компилирует сохранённый проект: несохранённые правки сначала сохраняются.
  const saved = await flushBeforeLeave();
  if (currentProjectId() !== projectId) return;
  if (!saved) {
    useSimulationStore.getState().failStart(null, null, "console.run.saveFailed");
    return;
  }
  useSimulationStore.getState().setPhase("compiling");
  try {
    const result = await startSimulation(projectId);
    if (currentProjectId() !== projectId) return;
    const warnings = result.validation.issues.filter((issue) => issue.severity === "WARNING").length;
    useSimulationStore.getState().finishStart(result.session, result.compilation, warnings);
  } catch (error) {
    if (currentProjectId() !== projectId) return;
    const apiError = error instanceof SimulationApiError ? error : null;
    useSimulationStore.getState().failStart(apiError?.code ?? null, apiError?.compilation ?? null, errorKey(error));
    if (apiError?.code === "CIRCUIT_HAS_ERRORS" || apiError?.code === "COMPILATION_FAILED") {
      useUiStore.getState().setBottomTab("problems");
    } else {
      useUiStore.getState().setBottomTab("console");
    }
  }
}

async function withCommand<T>(action: (projectId: string) => Promise<T>): Promise<T | null> {
  const projectId = currentProjectId();
  if (projectId === null) return null;
  try {
    return await action(projectId);
  } catch (error) {
    const code = error instanceof SimulationApiError ? error.code : null;
    useSimulationStore.getState().log("error", "console.command.failed", { code: code ?? "—" });
    useUiStore.getState().showNotice("notice.simulationCommandFailed");
    return null;
  }
}

/** Пауза, продолжение, остановка, reset активной сессии. */
export async function controlSimulation(command: SimulationCommand): Promise<void> {
  if (!ACTIVE_PHASES.has(useSimulationStore.getState().phase)) return;
  const result = await withCommand((projectId) => sendSimulationCommand(projectId, command));
  if (result !== null) useSimulationStore.getState().applySessionInfo(result.session);
}

/**
 * Нажатие или отпускание кнопки. Состояние показывается сразу, симулятор подтверждает его
 * событием `component_state_changed`.
 */
export async function setButtonPressed(componentId: string, pressed: boolean): Promise<void> {
  if (!ACTIVE_PHASES.has(useSimulationStore.getState().phase)) return;
  useSimulationStore.getState().setComponentLocal(componentId, { pressed });
  await withCommand((projectId) => setComponentInput(projectId, componentId, { pressed }));
}

/** Отправка строки в Serial; true — отправлено. */
export async function sendSerial(data: string): Promise<boolean> {
  if (data === "" || !ACTIVE_PHASES.has(useSimulationStore.getState().phase)) return false;
  const result = await withCommand((projectId) => sendSerialInput(projectId, data));
  return result !== null;
}
