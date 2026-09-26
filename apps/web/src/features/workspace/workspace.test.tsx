import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { createQueryClient } from "@/lib/query-client";
import { HEALTH_OK, jsonResponse, stubFetch } from "@/test/fetch";
import { FakeProjectsServer } from "@/test/projects-server";
import { render } from "@testing-library/react";

vi.mock("@/features/code-editor/code-editor", () => import("@/test/monaco-mock"));

function renderApp() {
  return render(<App queryClient={createQueryClient()} />);
}

describe("Workspace", () => {
  let server: FakeProjectsServer;

  beforeEach(() => {
    server = new FakeProjectsServer();
    stubFetch((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (server.handles(url)) return server.handle(url, init);
      return Promise.resolve(
        url.endsWith("/circuits/validate")
          ? jsonResponse({ issues: [], nets: [] }, 200)
          : jsonResponse(HEALTH_OK, 200),
      );
    });
  });

  it("renders all regions with accessible names and honest empty states", async () => {
    renderApp();

    expect(screen.getByRole("banner")).toHaveTextContent("MicroLab");
    expect(screen.getByRole("banner")).toHaveTextContent("Arduino UNO R3");
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();

    const components = screen.getByRole("navigation", { name: "Компоненты" });
    expect(components).toHaveTextContent("Arduino UNO R3");
    expect(screen.getByRole("button", { name: "Добавить на схему: Резистор" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Схема" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Свойства" })).toHaveTextContent(
      "Ничего не выбрано",
    );
    expect(screen.getByRole("region", { name: "Нижняя панель" })).toBeInTheDocument();

    // Разделители панелей доступны с клавиатуры.
    for (const name of [
      "Изменить ширину панели компонентов",
      "Изменить ширину панели свойств",
      "Изменить высоту нижней панели",
    ]) {
      expect(screen.getByRole("separator", { name })).toHaveAttribute("tabindex", "0");
    }

    // Нереализованных действий нет в интерфейсе.
    for (const name of [/запуск/i, /стоп/i, /пауза/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(await screen.findByRole("textbox", { name: "Редактор кода скетча" })).toBeInTheDocument();
    expect(await screen.findByText("Все системы работают")).toBeInTheDocument();
    // При первом запуске создаётся проект, и документ сразу сохранён.
    expect(await screen.findByRole("button", { name: "Переименовать проект: Новый проект" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeInTheDocument();
    expect(screen.getByText("Сохранено")).toBeInTheDocument();
  });

  it("switches bottom tabs; unfinished tabs are labelled as coming soon", async () => {
    const user = userEvent.setup();
    renderApp();
    const tabs = screen.getByRole("tablist", { name: "Вкладки нижней панели" });

    const codeTab = within(tabs).getByRole("tab", { name: "Код" });
    expect(codeTab).toHaveAttribute("aria-selected", "true");

    // Переключение с клавиатуры (в jsdom у панелей нулевые размеры, и щелчки мышью
    // перехватывает обработчик разделителей панелей).
    codeTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tabpanel", { name: "Консоль" })).toHaveTextContent("Нет сообщений");

    const serial = within(tabs).getByRole("tab", { name: /Монитор порта/ });
    expect(serial).toHaveTextContent("Скоро");
    await user.keyboard("{ArrowRight}");
    expect(serial).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: /Монитор порта/ })).toHaveTextContent(
      "Монитор порта появится вместе с симуляцией.",
    );

    // «Проблемы» работает: проверка схемы идёт на backend.
    const problems = within(tabs).getByRole("tab", { name: /Проблемы/ });
    expect(problems).not.toHaveTextContent("Скоро");
    await user.keyboard("{ArrowRight}");
    expect(problems).toHaveAttribute("aria-selected", "true");
    expect(
      await within(screen.getByRole("tabpanel", { name: /Проблемы/ })).findByText("Проблем не найдено."),
    ).toBeInTheDocument();

    // Редактор не размонтирован при переключении вкладок: панель «Код» лишь скрыта.
    const codePanel = screen.getByRole("tabpanel", { name: "Код", hidden: true });
    expect(codePanel).toHaveAttribute("data-state", "inactive");
    expect(
      within(codePanel).getByRole("textbox", { name: "Редактор кода скетча", hidden: true }),
    ).toBeInTheDocument();
  });

  it.each([
    ["Cmd+S", { key: "s", code: "KeyS", metaKey: true }],
    ["Ctrl+S", { key: "s", code: "KeyS", ctrlKey: true }],
    ["Ctrl+S (русская раскладка)", { key: "ы", code: "KeyS", ctrlKey: true }],
  ])("%s saves immediately", async (_name, init) => {
    renderApp();
    const editor = await screen.findByRole("textbox", { name: "Редактор кода скетча" });
    await screen.findByText("Сохранено");
    fireEvent.change(editor, { target: { value: "// изменено" } });
    expect(screen.getByText("Есть несохранённые изменения")).toBeInTheDocument();

    expect(fireEvent.keyDown(window, init)).toBe(false);
    expect(await screen.findByText("Сохранено")).toBeInTheDocument();
    const [stored] = server.projects.values();
    expect(stored?.code).toBe("// изменено");
  });

  it("Cmd+Enter is intercepted and explained", () => {
    vi.useFakeTimers();
    try {
      renderApp();
      const message = "Запуск появится в следующих версиях";
      expect(fireEvent.keyDown(window, { key: "Enter", code: "Enter", metaKey: true })).toBe(false);
      expect(screen.getByText(message)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByText(message)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not intercept other shortcuts", () => {
    renderApp();
    expect(fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "s", code: "KeyS" })).toBe(true);
  });
});
