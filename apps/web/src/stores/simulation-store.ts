import { create } from "zustand";

import type { CompileResponse, DisplayErrorCode, SimulationInfo } from "@/api/schemas";
import {
  payloadNumber,
  payloadString,
  type EventBatch,
  type SessionState,
  type SimulationEvent,
  type StreamMessage,
} from "@/features/simulation/events";
import { SerialDecoder } from "@/features/simulation/serial-decoder";
import type { TranslationKey } from "@/i18n/t";

/**
 * Состояние симуляции в интерфейсе:
 * - `idle` — симуляция не запускалась;
 * - `validating` — сохранение проекта перед запуском;
 * - `compiling` — сервер проверяет схему и компилирует скетч;
 * - `starting` — сервер запускает сессию симуляции;
 * - `running`, `paused` — сессия идёт или приостановлена;
 * - `stopped` — сессия остановлена;
 * - `error` — запуск не удался или сессия завершилась ошибкой.
 */
export type SimulationPhase =
  | "idle"
  | "validating"
  | "compiling"
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "error";

/** Фазы, в которых идёт запуск: повторный запуск и команды недоступны. */
export const PENDING_PHASES: ReadonlySet<SimulationPhase> = new Set(["validating", "compiling", "starting"]);

/** Фазы с активной сессией: доступны пауза, остановка, reset и входы. */
export const ACTIVE_PHASES: ReadonlySet<SimulationPhase> = new Set(["running", "paused"]);

/** Уровень вывода MCU по событиям симулятора. */
export interface PinState {
  /** `output-high`, `output-low`, `input`, `input-pullup`, `pwm`. */
  mode: string;
  /** Уровень, читаемый MCU. */
  value: number;
  /** Измеренная скважность PWM (0…1); null — нет измерения. */
  dutyCycle: number | null;
}

/** Состояние компонента по событиям симулятора (светодиод, кнопка). */
/** Канал составного индикатора (RGB-светодиод, сегмент индикатора). */
export interface LedChannelState {
  on: boolean;
  brightness: number;
  currentMa: number;
}

export interface ComponentSimState {
  on?: boolean;
  brightness?: number;
  currentMa?: number;
  pressed?: boolean;
  /** Каналы RGB-светодиода и сегменты индикатора. */
  channels?: Readonly<Record<string, LedChannelState>>;
  /** Положение движка потенциометра 0…1. */
  position?: number;
  /** Освещённость фоторезистора, лк. */
  illuminanceLux?: number;
  /** Пьезоизлучатель: звучит ли и с какой частотой. */
  active?: boolean;
  frequencyHz?: number;
  /** Сервопривод: угол вала (null — импульсов ещё не было) и наличие питания. */
  angle?: number | null;
  powered?: boolean;
}

function channelState(raw: unknown): LedChannelState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record["on"] !== "boolean") return null;
  const brightness = typeof record["brightness"] === "number" ? Math.min(1, Math.max(0, record["brightness"])) : 0;
  const currentMa = typeof record["currentMa"] === "number" ? record["currentMa"] : 0;
  return { on: record["on"], brightness, currentMa };
}

/** Замечание симулятора во время выполнения (simulation_error). */
export interface RuntimeIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
  subject: string | null;
  timeUs: number;
}

export type ConsoleLevel = "info" | "warning" | "error";

/** Строка консоли: локализуемое сообщение или текст вывода компилятора. */
export type ConsoleEntry =
  | {
      id: number;
      level: ConsoleLevel;
      kind: "message";
      key: TranslationKey;
      params: Readonly<Record<string, string>>;
      /** Симулированное время, мкс (для событий симуляции). */
      timeUs: number | null;
    }
  | { id: number; level: ConsoleLevel; kind: "output"; text: string; timeUs: null };

/** Предел длины текста монитора порта (символов); старые строки удаляются. */
export const SERIAL_MAX_CHARS = 64 * 1024;
/** Предел числа строк консоли. */
export const CONSOLE_MAX_ENTRIES = 500;
/** Предел числа замечаний симулятора. */
export const MAX_RUNTIME_ISSUES = 100;

interface SimulationData {
  phase: SimulationPhase;
  /** Сессия, к которой относятся события; null — сессии не было. */
  simulationId: string | null;
  /**
   * События о смене состояния сессии применяются, только если после начала запуска уже
   * пришло состояние новой сессии: иначе они относятся к предыдущей сессии.
   */
  acceptLifecycle: boolean;
  /** Симулированное время от включения питания, мкс. */
  timeUs: number;
  pins: Readonly<Record<string, PinState>>;
  components: Readonly<Record<string, ComponentSimState>>;
  serialText: string;
  runtimeIssues: readonly RuntimeIssue[];
  console: readonly ConsoleEntry[];
  /** Результат последней компиляции при запуске (диагностики — в «Проблемах» и редакторе). */
  compilation: CompileResponse | null;
  /** Код ошибки последнего неудачного запуска или завершения сессии. */
  errorCode: DisplayErrorCode | null;
}

interface SimulationActions {
  applyMessage: (message: StreamMessage) => void;
  resetForProject: () => void;
  beginRun: () => void;
  setPhase: (phase: SimulationPhase) => void;
  finishStart: (session: SimulationInfo, compilation: CompileResponse, warnings: number) => void;
  failStart: (errorCode: DisplayErrorCode | null, compilation: CompileResponse | null, key: TranslationKey) => void;
  applySessionInfo: (session: SimulationInfo) => void;
  setComponentLocal: (componentId: string, state: ComponentSimState) => void;
  log: (level: ConsoleLevel, key: TranslationKey, params?: Record<string, string>) => void;
  clearSerial: () => void;
  clearConsole: () => void;
}

export type SimulationState = SimulationData & SimulationActions;

const INITIAL: SimulationData = {
  phase: "idle",
  simulationId: null,
  acceptLifecycle: true,
  timeUs: 0,
  pins: {},
  components: {},
  serialText: "",
  runtimeIssues: [],
  console: [],
  compilation: null,
  errorCode: null,
};

let nextConsoleId = 1;
const decoder = new SerialDecoder();

function message(
  level: ConsoleLevel,
  key: TranslationKey,
  params: Record<string, string> = {},
  timeUs: number | null = null,
): ConsoleEntry {
  return { id: nextConsoleId++, level, kind: "message", key, params, timeUs };
}

function appendConsole(current: readonly ConsoleEntry[], added: readonly ConsoleEntry[]): readonly ConsoleEntry[] {
  if (added.length === 0) return current;
  const next = [...current, ...added];
  return next.length > CONSOLE_MAX_ENTRIES ? next.slice(next.length - CONSOLE_MAX_ENTRIES) : next;
}

/** Добавляет текст в монитор порта, удаляя самые старые строки сверх предела. */
export function appendSerial(current: string, added: string): string {
  if (added === "") return current;
  const next = current + added;
  if (next.length <= SERIAL_MAX_CHARS) return next;
  const cut = next.length - SERIAL_MAX_CHARS;
  const lineStart = next.indexOf("\n", cut);
  return lineStart === -1 ? next.slice(cut) : next.slice(lineStart + 1);
}

/** Фаза интерфейса по статусу сессии на сервере. */
export function phaseForStatus(status: SimulationInfo["status"]): SimulationPhase {
  switch (status) {
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "failed":
      return "error";
  }
}

/** Причины автоматической паузы и остановки с отдельным сообщением консоли. */
const PAUSE_KEYS: Readonly<Record<string, TranslationKey>> = {
  client: "console.sim.paused",
  cpu_halted: "console.sim.pausedCpuHalted",
  circuit_fault: "console.sim.pausedCircuitFault",
};

const STOP_KEYS: Readonly<Record<string, TranslationKey>> = {
  client: "console.sim.stopped",
  idle_timeout: "console.sim.stoppedIdle",
  session_timeout: "console.sim.stoppedTimeout",
  worker_failed: "console.sim.stoppedFailure",
  simulator_disconnected: "console.sim.stoppedDisconnected",
};

/** Локализованные описания замечаний симулятора; прочие коды показываются как есть. */
export const RUNTIME_ISSUE_KEYS: Readonly<Record<string, TranslationKey>> = {
  FLOATING_INPUT: "runtime.FLOATING_INPUT",
  UNDEFINED_INPUT_LEVEL: "runtime.UNDEFINED_INPUT_LEVEL",
  GPIO_OVERCURRENT: "runtime.GPIO_OVERCURRENT",
  GPIO_GROUP_OVERCURRENT: "runtime.GPIO_GROUP_OVERCURRENT",
  UNSUPPORTED_COMPONENT: "runtime.UNSUPPORTED_COMPONENT",
  UNSUPPORTED_PERIPHERAL: "runtime.UNSUPPORTED_PERIPHERAL",
  CIRCUIT_SHORT: "runtime.CIRCUIT_SHORT",
  INVALID_OPCODE: "runtime.INVALID_OPCODE",
  EVENT_RATE_LIMITED: "runtime.EVENT_RATE_LIMITED",
  SERIAL_OUTPUT_RATE_LIMITED: "runtime.SERIAL_OUTPUT_RATE_LIMITED",
  SIMULATION_SLOWER_THAN_REALTIME: "runtime.SIMULATION_SLOWER_THAN_REALTIME",
  SIMULATOR_UNAVAILABLE: "runtime.SIMULATOR_UNAVAILABLE",
};

function issueSubject(event: SimulationEvent): string | null {
  const pin = payloadString(event, "pin");
  if (pin !== undefined) return pin;
  const component = payloadString(event, "componentId");
  if (component !== undefined) return component;
  const pins = event.payload["pins"];
  return Array.isArray(pins) ? pins.filter((p) => typeof p === "string").join(", ") : null;
}

interface Working {
  pins: Record<string, PinState> | null;
  components: Record<string, ComponentSimState> | null;
  base: SimulationData;
}

function setPin(work: Working, pin: string, patch: Partial<PinState>): void {
  const pins = (work.pins ??= { ...work.base.pins });
  const previous = pins[pin] ?? { mode: "input", value: 0, dutyCycle: null };
  pins[pin] = { ...previous, ...patch };
}

function setComponent(work: Working, id: string, state: ComponentSimState): void {
  const components = (work.components ??= { ...work.base.components });
  components[id] = { ...components[id], ...state };
}

function componentState(event: SimulationEvent): ComponentSimState {
  const raw = event.payload["state"];
  if (typeof raw !== "object" || raw === null) return {};
  const record = raw as Record<string, unknown>;
  const state: ComponentSimState = {};
  if (typeof record["on"] === "boolean") state.on = record["on"];
  if (typeof record["pressed"] === "boolean") state.pressed = record["pressed"];
  if (typeof record["brightness"] === "number") state.brightness = Math.min(1, Math.max(0, record["brightness"]));
  if (typeof record["currentMa"] === "number") state.currentMa = record["currentMa"];
  const channels = record["channels"];
  if (typeof channels === "object" && channels !== null) {
    const parsed: Record<string, LedChannelState> = {};
    for (const [id, value] of Object.entries(channels as Record<string, unknown>)) {
      const channel = channelState(value);
      if (channel !== null) parsed[id] = channel;
    }
    state.channels = parsed;
  }
  for (const key of ["position", "illuminanceLux", "frequencyHz"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) state[key] = value;
  }
  if (typeof record["active"] === "boolean") state.active = record["active"];
  if (typeof record["powered"] === "boolean") state.powered = record["powered"];
  const angle = record["angle"];
  if (angle === null || (typeof angle === "number" && Number.isFinite(angle))) state.angle = angle;
  return state;
}

/**
 * Применяет события пачки к состоянию: возвращает изменённые поля (одно обновление
 * хранилища на сообщение). Объекты выводов и компонентов заменяются только для тех, что
 * изменились, поэтому подписки по id не срабатывают на чужие изменения.
 */
export function reduceBatch(state: SimulationData, batch: Pick<EventBatch, "timestamp" | "events">): Partial<SimulationData> {
  const work: Working = { pins: null, components: null, base: state };
  const consoleAdded: ConsoleEntry[] = [];
  let issues: RuntimeIssue[] | null = null;
  let serial = "";
  let phase = state.phase;
  let errorCode = state.errorCode;
  let cleared = false;

  for (const event of batch.events) {
    const time = event.timestamp;
    switch (event.type) {
      case "digital_pin_changed": {
        const pin = payloadString(event, "pin");
        const mode = payloadString(event, "mode");
        const value = payloadNumber(event, "value");
        if (pin !== undefined && mode !== undefined) {
          setPin(work, pin, mode === "pwm" ? { mode, value: value ?? 0 } : { mode, value: value ?? 0, dutyCycle: null });
        }
        break;
      }
      case "pwm_changed": {
        const pin = payloadString(event, "pin");
        const duty = payloadNumber(event, "dutyCycle");
        if (pin !== undefined && duty !== undefined) setPin(work, pin, { dutyCycle: duty });
        break;
      }
      case "component_state_changed": {
        const id = payloadString(event, "componentId");
        if (id !== undefined) setComponent(work, id, componentState(event));
        break;
      }
      case "serial_output": {
        const bytes = event.payload["bytes"];
        if (Array.isArray(bytes)) {
          serial += decoder.push(bytes.filter((b): b is number => typeof b === "number" && b >= 0 && b <= 255));
        }
        break;
      }
      case "simulation_error": {
        const code = payloadString(event, "code") ?? "UNKNOWN";
        const severity = payloadString(event, "severity") === "error" ? "error" : "warning";
        const issue: RuntimeIssue = {
          code,
          severity,
          message: payloadString(event, "message") ?? "",
          subject: issueSubject(event),
          timeUs: time,
        };
        issues ??= [...state.runtimeIssues];
        issues.push(issue);
        consoleAdded.push(
          message(
            severity,
            "console.sim.issue",
            { code, subject: issue.subject ?? "—", message: issue.message },
            time,
          ),
        );
        if (severity === "error" && event.payload["pc"] === undefined) errorCode = code;
        break;
      }
      case "simulation_reset":
        decoder.reset();
        consoleAdded.push(message("info", "console.sim.reset", {}, time));
        break;
      case "simulation_started":
        if (state.acceptLifecycle) {
          phase = "running";
          consoleAdded.push(message("info", "console.sim.started", {}, time));
        }
        break;
      case "simulation_paused":
        if (state.acceptLifecycle) {
          phase = "paused";
          const reason = payloadString(event, "reason") ?? "client";
          consoleAdded.push(
            message(reason === "client" ? "info" : "warning", PAUSE_KEYS[reason] ?? "console.sim.paused", {}, time),
          );
        }
        break;
      case "simulation_resumed":
        if (state.acceptLifecycle) {
          phase = "running";
          consoleAdded.push(message("info", "console.sim.resumed", {}, time));
        }
        break;
      case "simulation_stopped":
        if (state.acceptLifecycle) {
          const reason = payloadString(event, "reason") ?? "client";
          phase = errorCode !== null ? "error" : "stopped";
          cleared = true;
          consoleAdded.push(
            message(phase === "error" ? "error" : "info", STOP_KEYS[reason] ?? "console.sim.stopped", { reason }, time),
          );
        }
        break;
      default:
        break;
    }
  }

  const patch: Partial<SimulationData> = { timeUs: Math.max(state.timeUs, batch.timestamp) };
  if (cleared) {
    // Сессия завершена: холст возвращается к виду без симуляции.
    patch.pins = {};
    patch.components = {};
  } else {
    if (work.pins !== null) patch.pins = work.pins;
    if (work.components !== null) patch.components = work.components;
  }
  if (serial !== "") patch.serialText = appendSerial(state.serialText, serial);
  if (issues !== null) patch.runtimeIssues = issues.slice(-MAX_RUNTIME_ISSUES);
  if (consoleAdded.length > 0) patch.console = appendConsole(state.console, consoleAdded);
  if (phase !== state.phase) patch.phase = phase;
  if (errorCode !== state.errorCode) patch.errorCode = errorCode;
  return patch;
}

/** Состояние сессии при подключении или начале новой сессии. */
export function reduceSessionState(state: SimulationData, message: Pick<SessionState, "session" | "events" | "serialTail">): Partial<SimulationData> {
  const session = message.session;
  const pending = PENDING_PHASES.has(state.phase);
  if (session === null) {
    // Сессии на сервере нет (например, API перезапущен): активная фаза завершается.
    return pending || !ACTIVE_PHASES.has(state.phase)
      ? { pins: {}, components: {} }
      : { pins: {}, components: {}, phase: "stopped" };
  }
  const isNew = session.simulationId !== state.simulationId;
  const base: SimulationData = { ...state, pins: {}, components: {}, acceptLifecycle: true };
  // Снимок содержит только события состояния; лишние типы здесь не применяются.
  const snapshot = reduceBatch(base, {
    timestamp: session.timestamp,
    events: message.events.filter((event) =>
      ["digital_pin_changed", "pwm_changed", "component_state_changed"].includes(event.type),
    ),
  });
  const patch: Partial<SimulationData> = {
    simulationId: session.simulationId,
    acceptLifecycle: true,
    pins: snapshot.pins ?? {},
    components: snapshot.components ?? {},
    timeUs: session.timestamp,
  };
  if (isNew) {
    decoder.reset();
    patch.serialText = appendSerial("", decoder.push(message.serialTail));
    patch.runtimeIssues = [];
    patch.errorCode = session.errorCode;
  }
  patch.phase = pending ? (isNew ? "starting" : state.phase) : phaseForStatus(session.status);
  if (!ACTIVE_PHASES.has(patch.phase) && !PENDING_PHASES.has(patch.phase)) {
    patch.pins = {};
    patch.components = {};
  }
  return patch;
}

/**
 * Состояние симуляции открытого проекта: фаза, выводы и компоненты по событиям, монитор
 * порта, консоль, результат компиляции. Серверное состояние сессии приходит потоком
 * событий (WebSocket); запросы к API выполняются в features/simulation.
 */
export const useSimulationStore = create<SimulationState>()((set) => ({
  ...INITIAL,

  applyMessage: (msg) => {
    set((state) => (msg.type === "event_batch" ? reduceBatch(state, msg) : reduceSessionState(state, msg)));
  },
  resetForProject: () => {
    decoder.reset();
    set({ ...INITIAL });
  },
  beginRun: () => {
    set((state) => ({
      phase: "validating",
      acceptLifecycle: false,
      compilation: null,
      errorCode: null,
      console: appendConsole(state.console, [message("info", "console.run.saving")]),
    }));
  },
  setPhase: (phase) => {
    set((state) =>
      phase === "compiling"
        ? { phase, console: appendConsole(state.console, [message("info", "console.run.compiling")]) }
        : { phase },
    );
  },
  finishStart: (session, compilation, warnings) => {
    set((state) => {
      const entries: ConsoleEntry[] = [];
      const sizes = compilation.sizes;
      if (sizes !== null) {
        entries.push(
          message("info", "console.compile.success", {
            flash: String(sizes.flashBytes),
            flashMax: String(sizes.flashMaxBytes),
            ram: String(sizes.ramBytes),
            ramMax: String(sizes.ramMaxBytes),
            duration: String(compilation.durationMs),
          }),
        );
      }
      if (compilation.compilerOutput.trim() !== "") {
        entries.push({ id: nextConsoleId++, level: "info", kind: "output", text: compilation.compilerOutput.trimEnd(), timeUs: null });
      }
      if (warnings > 0) entries.push(message("warning", "console.run.circuitWarnings", { count: String(warnings) }));
      const isNew = session.simulationId !== state.simulationId;
      const pending = PENDING_PHASES.has(state.phase);
      return {
        compilation,
        simulationId: session.simulationId,
        acceptLifecycle: true,
        phase: pending ? phaseForStatus(session.status) : state.phase,
        ...(isNew ? { pins: {}, components: {}, runtimeIssues: [] } : {}),
        console: appendConsole(state.console, entries),
      };
    });
  },
  failStart: (errorCode, compilation, key) => {
    set((state) => {
      const entries: ConsoleEntry[] = [message("error", key, { code: errorCode ?? "—" })];
      if (compilation !== null && compilation.compilerOutput.trim() !== "") {
        entries.push({ id: nextConsoleId++, level: "error", kind: "output", text: compilation.compilerOutput.trimEnd(), timeUs: null });
      }
      return {
        phase: "error",
        acceptLifecycle: true,
        errorCode,
        compilation: compilation ?? state.compilation,
        console: appendConsole(state.console, entries),
      };
    });
  },
  applySessionInfo: (session) => {
    set((state) => {
      if (session.simulationId !== state.simulationId || PENDING_PHASES.has(state.phase)) return state;
      const phase = phaseForStatus(session.status);
      if (phase === state.phase) return state;
      return ACTIVE_PHASES.has(phase) ? { phase } : { phase, pins: {}, components: {} };
    });
  },
  setComponentLocal: (componentId, componentState) => {
    set((state) => ({ components: { ...state.components, [componentId]: { ...state.components[componentId], ...componentState } } }));
  },
  log: (level, key, params = {}) => {
    set((state) => ({ console: appendConsole(state.console, [message(level, key, params)]) }));
  },
  clearSerial: () => {
    set({ serialText: "" });
  },
  clearConsole: () => {
    set({ console: [] });
  },
}));

/** Яркость встроенного светодиода «L» по уровню D13 (0…1): поведенческая индикация. */
export function builtinLedLevel(pin: PinState | undefined): number {
  if (pin === undefined) return 0;
  if (pin.mode === "output-high") return 1;
  if (pin.mode === "pwm") return pin.dutyCycle ?? pin.value;
  return 0;
}
