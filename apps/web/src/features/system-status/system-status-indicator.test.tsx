import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SystemStatusIndicator } from "./system-status-indicator";
import { HEALTH_DB_DOWN, HEALTH_OK, jsonResponse, stubFetch } from "@/test/fetch";
import { renderWithQueryClient } from "@/test/render";

function statusRegion() {
  return screen.getByRole("status");
}

async function openDetails() {
  const user = userEvent.setup();
  await user.click(within(statusRegion()).getByRole("button"));
  return { user, dialog: await screen.findByRole("dialog") };
}

function row(dialog: HTMLElement, label: string) {
  const term = within(dialog).getByText(label, { selector: "dt" });
  const container = term.parentElement;
  if (container === null) {
    throw new Error(`Row ${label} has no container`);
  }
  return within(container);
}

describe("SystemStatusIndicator", () => {
  it("loading: shows checking text and skeleton rows, no retry", async () => {
    stubFetch(() => new Promise<Response>(() => undefined));
    renderWithQueryClient(<SystemStatusIndicator />);

    expect(within(statusRegion()).getByRole("button")).toHaveTextContent("Проверка…");
    const { dialog } = await openDetails();
    expect(within(dialog).getByText("Проверка состояния системы")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button")).not.toBeInTheDocument();
  });

  it("ok: summary in the status bar, details in the popover", async () => {
    stubFetch(() => Promise.resolve(jsonResponse(HEALTH_OK, 200, { "X-Request-ID": "req-ok" })));
    renderWithQueryClient(<SystemStatusIndicator />);

    expect(await within(statusRegion()).findByText("Все системы работают")).toBeInTheDocument();
    const { dialog } = await openDetails();
    expect(row(dialog, "Backend").getByText("Доступен")).toBeInTheDocument();
    expect(row(dialog, "База данных").getByText("Доступна")).toBeInTheDocument();
    expect(row(dialog, "Версия API").getByText("1.0.0")).toBeInTheDocument();
    expect(within(dialog).getByText(/^Проверено в \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Проверить снова" })).toHaveAttribute(
      "data-variant",
      "outline",
    );
  });

  it("databaseDown: backend available, database unavailable, code shown", async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse(HEALTH_DB_DOWN, 503, { "X-Request-ID": "req-503" })),
    );
    renderWithQueryClient(<SystemStatusIndicator />);

    expect(await within(statusRegion()).findByText("БД недоступна")).toBeInTheDocument();
    const { dialog } = await openDetails();
    expect(row(dialog, "Backend").getByText("Доступен")).toBeInTheDocument();
    expect(row(dialog, "База данных").getByText("Недоступна")).toBeInTheDocument();
    expect(within(dialog).getByText("Код: DATABASE_UNAVAILABLE")).toBeInTheDocument();
    expect(within(dialog).getByText("Request ID: req-503")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Проверить снова" })).toHaveAttribute(
      "data-variant",
      "default",
    );
  });

  it.each([
    ["network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["502 from the proxy", () => Promise.resolve(new Response("", { status: 502 }))],
    ["504 from the proxy", () => Promise.resolve(new Response("", { status: 504 }))],
  ])("backendUnreachable (%s)", async (_name, implementation) => {
    stubFetch(implementation);
    renderWithQueryClient(<SystemStatusIndicator />);

    expect(await within(statusRegion()).findByText("Backend недоступен")).toBeInTheDocument();
    const { dialog } = await openDetails();
    expect(row(dialog, "Backend").getByText("Недоступен")).toBeInTheDocument();
    expect(row(dialog, "База данных").getByText("Неизвестно")).toBeInTheDocument();
    expect(row(dialog, "Версия API").getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
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
          ),
        ),
      "HTTP 500",
      "Код: INTERNAL_ERROR",
    ],
  ])("unexpected (%s)", async (_name, implementation, httpText, codeText) => {
    stubFetch(implementation);
    renderWithQueryClient(<SystemStatusIndicator />);

    expect(
      await within(statusRegion()).findByText("Неожиданный ответ сервера"),
    ).toBeInTheDocument();
    const { dialog } = await openDetails();
    expect(row(dialog, "Backend").getByText("Ошибка ответа")).toBeInTheDocument();
    expect(within(dialog).getByText(httpText)).toBeInTheDocument();
    if (codeText !== null) {
      expect(within(dialog).getByText(codeText)).toBeInTheDocument();
    }
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it("retry keeps the previous result and updates it; repeated clicks are ignored", async () => {
    let respond: (response: Response) => void = () => undefined;
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(HEALTH_DB_DOWN, 503)));
    renderWithQueryClient(<SystemStatusIndicator />);
    expect(await within(statusRegion()).findByText("БД недоступна")).toBeInTheDocument();

    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    const { user, dialog } = await openDetails();
    const retry = within(dialog).getByRole("button", { name: "Проверить снова" });
    await user.click(retry);

    expect(within(statusRegion()).getByText("БД недоступна")).toBeInTheDocument();
    expect(retry).toHaveAttribute("aria-disabled", "true");
    await user.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    respond(jsonResponse(HEALTH_OK, 200));
    expect(await within(statusRegion()).findByText("Все системы работают")).toBeInTheDocument();
    await waitFor(() => {
      expect(retry).not.toHaveAttribute("aria-disabled");
    });
  });
});
