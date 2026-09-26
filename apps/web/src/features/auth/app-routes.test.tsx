import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { apiFetch, CSRF_HEADER, setUnauthorizedHandler } from "@/api/http";
import { matchRoute, safeReturnPath } from "@/lib/router";
import { jsonResponse, stubFetch } from "@/test/fetch";

import { AppRoutes } from "./app-routes";

const USER = {
  id: "u1",
  email: "teacher@example.edu",
  displayName: "Пётр Петрович",
  role: "teacher",
  mustChangePassword: false,
} as const;

function unauthorized() {
  return jsonResponse({ error: { code: "AUTH_REQUIRED", message: "x", details: [] } }, 401);
}

function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("router", () => {
  it("matches routes and keeps return paths internal", () => {
    expect(matchRoute("/join/ABCD2345EFGH")).toEqual({ name: "register", code: "ABCD2345EFGH" });
    expect(matchRoute("/view/p1")).toEqual({ name: "viewProject", id: "p1" });
    expect(matchRoute("/login?next=%2Fgroups")).toEqual({ name: "login", next: "/groups" });
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
  });
});

describe("apiFetch", () => {
  it("sends the CSRF header on changing requests and reports expired sessions", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(unauthorized()));
    let expired = 0;
    const release = setUnauthorizedHandler(() => {
      expired += 1;
    });
    await apiFetch("/api/v1/projects", { method: "POST" });
    await apiFetch("/api/v1/projects");
    await apiFetch("/api/v1/auth/login", { method: "POST" });
    release();
    const [first, second] = fetchMock.mock.calls;
    expect((first?.[1]?.headers as Record<string, string>)[CSRF_HEADER]).toBe("1");
    expect((second?.[1]?.headers as Record<string, string>)[CSRF_HEADER]).toBeUndefined();
    expect(first?.[1]?.credentials).toBe("same-origin");
    // Ошибка входа (/auth/*) не считается истёкшей сессией.
    expect(expired).toBe(2);
  });
});

describe("AppRoutes", () => {
  it("redirects anonymous users to login and returns after login", async () => {
    let loggedIn = false;
    const fetchMock = stubFetch((input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/auth/login")) {
        loggedIn = true;
        return Promise.resolve(jsonResponse(USER, 200));
      }
      if (url.endsWith("/auth/me")) return Promise.resolve(loggedIn ? jsonResponse(USER, 200) : unauthorized());
      if (url.endsWith("/api/v1/groups")) return Promise.resolve(jsonResponse({ items: [] }, 200));
      return Promise.resolve(jsonResponse({}, 404));
    });
    renderAt("/groups");

    const email = await screen.findByLabelText("Электронная почта");
    expect(window.location.search).toBe("?next=%2Fgroups");
    const user = userEvent.setup();
    await user.type(email, USER.email);
    await user.type(screen.getByLabelText("Пароль"), "wrong-password");

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(jsonResponse({ error: { code: "INVALID_CREDENTIALS", message: "x", details: [] } }, 401)),
    );
    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Неверная почта или пароль.");

    await user.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByRole("heading", { name: "Мои группы" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/groups");
  });

  it("prefills the invite code from a join link", async () => {
    stubFetch(() => Promise.resolve(unauthorized()));
    renderAt("/join/ABCD2345EFGH");
    expect(await screen.findByLabelText("Код приглашения")).toHaveValue("ABCD2345EFGH");
  });

  it("forces a password change for temporary passwords", async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ...USER, mustChangePassword: true }, 200)));
    renderAt("/groups");
    expect(await screen.findByRole("heading", { name: "Смена пароля" })).toBeInTheDocument();
    expect(screen.getByText(/временный пароль/)).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/change-password");
    });
  });

  it("hides staff pages from students", async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ...USER, role: "student" }, 200)));
    renderAt("/admin/users");
    expect(await screen.findByRole("heading", { name: "Недостаточно прав для этой страницы." })).toBeInTheDocument();
  });

  it("shows mismatched new passwords as a form error", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(USER, 200)));
    renderAt("/change-password");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Текущий пароль"), "old-password");
    await user.type(screen.getByLabelText("Новый пароль"), "new-password-1");
    await user.type(screen.getByLabelText("Повторите новый пароль"), "new-password-2");
    await user.click(screen.getByRole("button", { name: "Сменить пароль" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Пароли не совпадают.");
  });
});
