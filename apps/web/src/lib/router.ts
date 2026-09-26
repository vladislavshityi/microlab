import { useSyncExternalStore } from "react";

/**
 * Минимальная маршрутизация на History API (без библиотеки: маршрутов немного и они
 * плоские). Адрес — единственный источник истины; `navigate` меняет его и оповещает
 * подписчиков.
 */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

/** Текущий путь с query-строкой, например `/login?next=%2F`. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (options.replace === true) {
    window.history.replaceState(null, "", to);
  } else {
    window.history.pushState(null, "", to);
  }
  notify();
}

/** Внутренний путь для возврата после входа; чужие адреса отбрасываются. */
export function safeReturnPath(raw: string | null): string {
  if (raw === null || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export function loginPath(returnTo: string): string {
  return returnTo === "/" ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`;
}

export type Route =
  | { name: "workspace" }
  | { name: "login"; next: string }
  | { name: "register"; code: string }
  | { name: "changePassword"; next: string }
  | { name: "groups" }
  | { name: "group"; id: string }
  | { name: "viewProject"; id: string }
  | { name: "adminUsers" }
  | { name: "notFound" };

export function matchRoute(location: string): Route {
  const url = new URL(location, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const next = safeReturnPath(url.searchParams.get("next"));
  if (path === "/") return { name: "workspace" };
  if (path === "/login") return { name: "login", next };
  if (path === "/register") return { name: "register", code: url.searchParams.get("code") ?? "" };
  if (path === "/change-password") return { name: "changePassword", next };
  if (path === "/groups") return { name: "groups" };
  if (path === "/admin/users") return { name: "adminUsers" };
  const segments = path.split("/").slice(1).map((part) => decodeURIComponent(part));
  const [first, second] = segments;
  if (segments.length === 2 && second !== undefined && second !== "") {
    if (first === "join") return { name: "register", code: second };
    if (first === "groups") return { name: "group", id: second };
    if (first === "view") return { name: "viewProject", id: second };
  }
  return { name: "notFound" };
}
