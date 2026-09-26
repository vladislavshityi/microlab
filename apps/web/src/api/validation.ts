import { apiFetch } from "./http";
import type { CircuitDocument } from "@microlab/circuit-schema";

import { CircuitValidationResponseSchema, type CircuitValidationResponse } from "./schemas";

const VALIDATE_CIRCUIT_URL = "/api/v1/circuits/validate";

/** Клиентский лимит на один запрос проверки схемы. */
const VALIDATE_TIMEOUT_MS = 10_000;

/** Проверка не выполнена: сервер недоступен или ответил не по контракту. */
export class CircuitValidationError extends Error {
  readonly kind: "unreachable" | "unexpected";

  constructor(kind: "unreachable" | "unexpected", message: string) {
    super(message);
    this.name = "CircuitValidationError";
    this.kind = kind;
  }
}

/**
 * `POST /api/v1/circuits/validate`: замечания к схеме и netlist. Замечания — результат
 * проверки (ответ 200), поэтому исключение означает только сбой самой проверки.
 */
export async function validateCircuit(
  document: CircuitDocument,
  signal?: AbortSignal,
): Promise<CircuitValidationResponse> {
  const timeout = AbortSignal.timeout(VALIDATE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await apiFetch(VALIDATE_CIRCUIT_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(document),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new CircuitValidationError("unreachable", "Validation request failed.");
  }
  if (response.status === 502 || response.status === 504) {
    throw new CircuitValidationError("unreachable", `HTTP ${response.status}`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = CircuitValidationResponseSchema.safeParse(body);
  if (response.status !== 200 || !parsed.success) {
    throw new CircuitValidationError("unexpected", `Unexpected response (HTTP ${response.status}).`);
  }
  return parsed.data;
}
