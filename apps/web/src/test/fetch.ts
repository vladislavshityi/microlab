import { vi } from "vitest";

export const HEALTH_OK = {
  status: "ok",
  version: "1.0.0",
  checks: { database: { status: "ok" } },
} as const;

export const HEALTH_DB_DOWN = {
  status: "unavailable",
  version: "1.0.0",
  checks: { database: { status: "error", code: "DATABASE_UNAVAILABLE" } },
} as const;

export function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Подменяет глобальный fetch (восстанавливается автоматически: `unstubGlobals` в vite.config.ts). */
export function stubFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
