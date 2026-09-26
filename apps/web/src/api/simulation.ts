import { apiFetch } from "./http";
import {
  CircuitValidationResponseSchema,
  CompileResponseSchema,
  readDisplayErrorCode,
  SimulationCommandResponseSchema,
  SimulationStartResponseSchema,
  type CircuitValidationResponse,
  type CompileResponse,
  type DisplayErrorCode,
  type SimulationCommandResponse,
  type SimulationStartResponse,
} from "./schemas";

/** Запуск включает проверку схемы и компиляцию на сервере: лимит с запасом над компиляцией (90 с). */
export const START_TIMEOUT_MS = 120_000;
/** Лимит на команду управления симуляцией. */
export const COMMAND_TIMEOUT_MS = 15_000;

export type SimulationCommand = "pause" | "resume" | "stop" | "reset";

/**
 * Сбой запроса к API симуляции.
 * - `unreachable` — сеть, таймаут или шлюз не достучался до API;
 * - `http` — сервер ответил ошибкой; `code` — стабильный код ошибки API, если он есть;
 * - `unexpected` — ответ не соответствует контракту.
 *
 * Для ошибок запуска `validation` и `compilation` содержат результат, который помешал
 * запуску (замечания схемы или диагностики компилятора).
 */
export class SimulationApiError extends Error {
  readonly kind: "unreachable" | "http" | "unexpected";
  readonly status: number | null;
  readonly code: DisplayErrorCode | null;
  readonly validation: CircuitValidationResponse | null;
  readonly compilation: CompileResponse | null;

  constructor(
    kind: "unreachable" | "http" | "unexpected",
    status: number | null,
    code: DisplayErrorCode | null,
    extra: { validation?: CircuitValidationResponse | null; compilation?: CompileResponse | null } = {},
  ) {
    super(`Simulation API request failed: ${kind} (HTTP ${status ?? "-"}, ${code ?? "no code"}).`);
    this.name = "SimulationApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.validation = extra.validation ?? null;
    this.compilation = extra.compilation ?? null;
  }
}

function simulationUrl(projectId: string, action: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/simulation/${action}`;
}

/** Адрес потока событий симуляции проекта (WebSocket на том же хосте, что и API). */
export function simulationEventsUrl(projectId: string, location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/v1/ws/projects/${encodeURIComponent(projectId)}/simulation`;
}

function readExtra(body: unknown): { validation: CircuitValidationResponse | null; compilation: CompileResponse | null } {
  if (typeof body !== "object" || body === null) return { validation: null, compilation: null };
  const record = body as Record<string, unknown>;
  const validation = CircuitValidationResponseSchema.safeParse(record["validation"]);
  const compilation = CompileResponseSchema.safeParse(record["compilation"]);
  return {
    validation: validation.success ? validation.data : null,
    compilation: compilation.success ? compilation.data : null,
  };
}

async function post(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await apiFetch(url, {
      method: "POST",
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SimulationApiError("unreachable", null, null);
  }
  const parsed: unknown = await response.json().catch(() => undefined);
  if (response.ok) return { status: response.status, body: parsed };
  const code = readDisplayErrorCode(parsed);
  if ((response.status === 502 || response.status === 504) && code === null) {
    throw new SimulationApiError("unreachable", response.status, null);
  }
  throw new SimulationApiError("http", response.status, code, readExtra(parsed));
}

/** Проверка схемы, компиляция и запуск сохранённого проекта. */
export async function startSimulation(projectId: string): Promise<SimulationStartResponse> {
  const { status, body } = await post(simulationUrl(projectId, "start"), undefined, START_TIMEOUT_MS);
  const parsed = SimulationStartResponseSchema.safeParse(body);
  if (!parsed.success) throw new SimulationApiError("unexpected", status, null);
  return parsed.data;
}

async function command(projectId: string, action: string, body?: unknown): Promise<SimulationCommandResponse> {
  const { status, body: data } = await post(simulationUrl(projectId, action), body, COMMAND_TIMEOUT_MS);
  const parsed = SimulationCommandResponseSchema.safeParse(data);
  if (!parsed.success) throw new SimulationApiError("unexpected", status, null);
  return parsed.data;
}

export function sendSimulationCommand(projectId: string, action: SimulationCommand): Promise<SimulationCommandResponse> {
  return command(projectId, action);
}

/** Вход компонента: кнопка, положение движка потенциометра (0…1), освещённость фоторезистора (лк). */
export type ComponentInput = { pressed: boolean } | { position: number } | { illuminanceLux: number };

/** Изменение входа компонента. */
export function setComponentInput(
  projectId: string,
  componentId: string,
  input: ComponentInput,
): Promise<SimulationCommandResponse> {
  return command(projectId, "input", { componentId, input });
}

/** Данные на вход UART0 (Serial). */
export function sendSerialInput(projectId: string, data: string): Promise<SimulationCommandResponse> {
  return command(projectId, "serial", { data });
}
