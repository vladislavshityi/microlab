/**
 * Обёртка над fetch для запросов к API.
 *
 * - изменяющие запросы несут заголовок защиты от CSRF (`X-MicroLab-Request: 1`): сервер
 *   отклоняет изменяющие запросы без него;
 * - cookie сессии отправляется только на свой origin;
 * - ответ 401 на запрос вне `/auth/*` означает, что сессия закончилась: вызывается
 *   обработчик (переход на страницу входа с сохранением текущего адреса).
 */
export const CSRF_HEADER = "X-MicroLab-Request";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let unauthorizedHandler: (() => void) | null = null;

/** Устанавливает обработчик истёкшей сессии; возвращает функцию снятия. */
export function setUnauthorizedHandler(handler: (() => void) | null): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (!SAFE_METHODS.has(method)) headers[CSRF_HEADER] = "1";
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (response.status === 401 && !url.startsWith("/api/v1/auth/")) {
    unauthorizedHandler?.();
  }
  return response;
}
