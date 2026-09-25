import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SystemStatusPage } from "./system-status-page";
import { HEALTH_DB_DOWN, HEALTH_OK, jsonResponse, stubFetch } from "@/test/fetch";
import { renderWithQueryClient } from "@/test/render";

function statusRegion() {
  return screen.getByRole("status");
}

function row(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  const container = term.parentElement;
  if (container === null) {
    throw new Error(`Row ${label} has no container`);
  }
  return within(container);
}

describe("SystemStatusPage", () => {
  it("state 1 — loading: skeleton, busy card, no summary, no retry", () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    renderWithQueryClient(<SystemStatusPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Состояние системы" })).toBeInTheDocument();
    expect(screen.getByText("Проверка состояния системы")).toBeInTheDocument();
    expect(statusRegion()).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("state 2 — ok: both available, version, secondary retry", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(HEALTH_OK, 200, { "X-Request-ID": "req-ok" })));
    renderWithQueryClient(<SystemStatusPage />);

    expect(await within(statusRegion()).findByText("Все системы работают")).toBeInTheDocument();
    expect(row("Backend").getByText("Доступен")).toBeInTheDocument();
    expect(row("База данных").getByText("Доступна")).toBeInTheDocument();
    expect(row("Версия API").getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText(/^Проверено в \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Проверить снова" });
    expect(retry).toHaveAttribute("data-variant", "outline");
    expect(document.title).toBe("Состояние системы — MicroLab");
  });

  it("state 3 — databaseDown: backend available, database unavailable, code shown", async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse(HEALTH_DB_DOWN, 503, { "X-Request-ID": "req-503" })),
    );
    renderWithQueryClient(<SystemStatusPage />);

    expect(await within(statusRegion()).findByText("БД недоступна")).toBeInTheDocument();
    expect(row("Backend").getByText("Доступен")).toBeInTheDocument();
    expect(row("База данных").getByText("Недоступна")).toBeInTheDocument();
    expect(row("Версия API").getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("Код: DATABASE_UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req-503")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Проверить снова" })).toHaveAttribute(
      "data-variant",
      "default",
    );
  });

  it.each([
    ["network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["502 from the proxy", () => Promise.resolve(new Response("", { status: 502 }))],
    ["504 from the proxy", () => Promise.resolve(new Response("", { status: 504 }))],
  ])("state 4 — backendUnreachable (%s)", async (_name, implementation) => {
    stubFetch(implementation);
    renderWithQueryClient(<SystemStatusPage />);

    expect(await within(statusRegion()).findByText("Backend недоступен")).toBeInTheDocument();
    expect(row("Backend").getByText("Недоступен")).toBeInTheDocument();
    expect(row("База данных").getByText("Неизвестно")).toBeInTheDocument();
    expect(row("Версия API").getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Проверить снова" })).toHaveAttribute(
      "data-variant",
      "default",
    );
  });

  it.each([
    ["invalid body", () => Promise.resolve(jsonResponse({ status: "ok" }, 200)), "HTTP 200", null],
    [
      "500 INTERNAL_ERROR",
      () =>
        Promise.resolve(
          jsonResponse(
            { error: { code: "INTERNAL_ERROR", message: "boom: secret dsn", details: [] } },
            500,
            { "X-Request-ID": "req-500" },
          ),
        ),
      "HTTP 500",
      "Код: INTERNAL_ERROR",
    ],
    [
      "500 with a code unknown to this frontend",
      () =>
        Promise.resolve(
          jsonResponse({ error: { code: "RATE_LIMITED", message: "secret", details: [] } }, 500),
        ),
      "HTTP 500",
      "Код: RATE_LIMITED",
    ],
  ])("state 5 — unexpected (%s)", async (_name, implementation, httpText, codeText) => {
    stubFetch(implementation);
    renderWithQueryClient(<SystemStatusPage />);

    expect(
      await within(statusRegion()).findByText("Неожиданный ответ сервера"),
    ).toBeInTheDocument();
    expect(row("Backend").getByText("Ошибка ответа")).toBeInTheDocument();
    expect(row("База данных").getByText("Неизвестно")).toBeInTheDocument();
    expect(row("Версия API").getByText("—")).toBeInTheDocument();
    expect(screen.getByText(httpText)).toBeInTheDocument();
    if (codeText !== null) {
      expect(screen.getByText(codeText)).toBeInTheDocument();
    }
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it("retry keeps the previous result on screen and updates it; focus stays on the button", async () => {
    const user = userEvent.setup();
    let respond: (response: Response) => void = () => undefined;
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(HEALTH_DB_DOWN, 503)));
    renderWithQueryClient(<SystemStatusPage />);
    expect(await screen.findByText("БД недоступна")).toBeInTheDocument();

    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    const retry = screen.getByRole("button", { name: "Проверить снова" });
    await user.click(retry);

    // Во время повторной проверки прежний результат остаётся; кнопка помечена как занятая.
    expect(screen.getByText("БД недоступна")).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).toHaveFocus();
    // Повторный клик во время проверки не запускает ещё один запрос.
    await user.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    respond(jsonResponse(HEALTH_OK, 200));
    expect(await screen.findByText("Все системы работают")).toBeInTheDocument();
    await waitFor(() => {
      expect(retry).not.toHaveAttribute("aria-disabled");
    });
    expect(retry).toHaveFocus();
  });
});
