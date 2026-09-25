import { HealthResponseSchema, readDisplayErrorCode, type DisplayErrorCode } from "./schemas";

export const HEALTH_URL = "/api/v1/health";

/** Клиентский лимит на один health-запрос. Backend ограничивает проверку БД 2 с. */
export const HEALTH_TIMEOUT_MS = 10_000;

/** Тот же формат request id, что принимает и генерирует backend. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Результат одной проверки состояния — все состояния страницы, кроме загрузки
 * (`loading` — это сам ожидающий query). Содержит только стабильные значения для
 * отображения: никогда сырые тела ответов или текст исключений.
 */
export type HealthResult =
  | { kind: "ok"; version: string; requestId: string | null }
  | {
      kind: "databaseDown";
      version: string;
      code: DisplayErrorCode | null;
      requestId: string | null;
    }
  | { kind: "backendUnreachable"; httpStatus: number | null; requestId: string | null }
  | {
      kind: "unexpected";
      httpStatus: number | null;
      code: DisplayErrorCode | null;
      requestId: string | null;
    };

function readRequestId(response: Response): string | null {
  const value = response.headers.get("X-Request-ID");
  return value !== null && REQUEST_ID_PATTERN.test(value) ? value : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Отображает HTTP-ответ в состояние health:
 * - 200 + корректное тело со status "ok" и database "ok"                  → ok
 * - 503 + корректное тело со status "unavailable" и database "error"      → databaseDown
 * - 502 / 504 (dev proxy или gateway не может достучаться до API)         → backendUnreachable
 * - всё остальное (некорректное или противоречивое тело, другой статус)  → unexpected
 */
export async function interpretHealthResponse(response: Response): Promise<HealthResult> {
  const requestId = readRequestId(response);

  if (response.status === 502 || response.status === 504) {
    return { kind: "backendUnreachable", httpStatus: response.status, requestId };
  }

  const body = await readJson(response);

  if (response.status === 200 || response.status === 503) {
    const parsed = HealthResponseSchema.safeParse(body);
    if (parsed.success) {
      const { status, version, checks } = parsed.data;
      if (response.status === 200 && status === "ok" && checks.database.status === "ok") {
        return { kind: "ok", version, requestId };
      }
      if (
        response.status === 503 &&
        status === "unavailable" &&
        checks.database.status === "error"
      ) {
        return {
          kind: "databaseDown",
          version,
          code: checks.database.code ?? null,
          requestId,
        };
      }
    }
  }

  return {
    kind: "unexpected",
    httpStatus: response.status,
    code: readDisplayErrorCode(body),
    requestId,
  };
}

/**
 * Выполняет `GET /api/v1/health` по относительному URL (в разработке — через Vite dev proxy).
 * Никогда не бросает исключение при сетевых или HTTP-ошибках — это состояния health, а не
 * исключения. Пробрасывает только отмену, запрошенную вызывающим кодом (её обрабатывает
 * TanStack Query).
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResult> {
  const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(HEALTH_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted === true && isAbortError(error)) {
      throw error;
    }
    // Сетевая ошибка (соединение отклонено, DNS, offline) или клиентский таймаут.
    return { kind: "backendUnreachable", httpStatus: null, requestId: null };
  }

  return interpretHealthResponse(response);
}
