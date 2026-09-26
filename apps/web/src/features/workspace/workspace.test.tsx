import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { createQueryClient } from "@/lib/query-client";
import { HEALTH_OK, jsonResponse, stubFetch } from "@/test/fetch";
import { FakeProjectsServer } from "@/test/projects-server";
import { render } from "@testing-library/react";

vi.mock("@/features/code-editor/code-editor", () => import("@/test/monaco-mock"));

async function renderApp() {
  const result = render(<App queryClient={createQueryClient()} />);
  // Сначала проверяется сессия (GET /auth/me), затем открывается рабочее пространство.
  await screen.findByRole("banner");
  return result;
}

const TEST_USER = {
  id: "user-1",
  email: "student@example.edu",
  displayName: "Студент",
  role: "student",
  mustChangePassword: false,
};

describe("Workspace", () => {
  let server: FakeProjectsServer;

  beforeEach(() => {
    server = new FakeProjectsServer();
    stubFetch((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (server.handles(url)) return server.handle(url, init);
      if (url.endsWith("/auth/me")) return Promise.resolve(jsonResponse(TEST_USER, 200));
      return Promise.resolve(
        url.endsWith("/circuits/validate")
          ? jsonResponse({ issues: [], nets: [] }, 200)
          : jsonResponse(HEALTH_OK, 200),
      );
    });
  });

  it("renders all regions with accessible names and honest empty states", async () => {
    await renderApp();

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

    // Управление симуляцией: до запуска доступен только запуск (после открытия проекта).
    const controls = screen.getByRole("group", { name: "Управление симуляцией" });
    for (const name of ["Пауза", "Остановить", "Reset микроконтроллера"]) {
      expect(within(controls).getByRole("button", { name })).toBeDisabled();
    }
    expect(within(controls).getByRole("status")).toHaveTextContent("Не запущена");
    expect(await screen.findByRole("textbox", { name: "Редактор кода скетча" })).toBeInTheDocument();
    expect(await screen.findByText("Все системы работают")).toBeInTheDocument();
    // При первом запуске создаётся проект, и документ сразу сохранён.
    expect(await screen.findByRole("button", { name: "Переименовать проект: Новый проект" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сохранить/ })).toBeInTheDocument();
    expect(screen.getByText("Сохранено")).toBeInTheDocument();
    expect(within(controls).getByRole("button", { name: /Проверить, скомпилировать и запустить/ })).toBeEnabled();
  });

  it("switches bottom tabs", async () => {
    const user = userEvent.setup();
    await renderApp();
    const tabs = screen.getByRole("tablist", { name: "Вкладки нижней панели" });

    const codeTab = within(tabs).getByRole("tab", { name: "Код" });
    expect(codeTab).toHaveAttribute("aria-selected", "true");

    // Переключение с клавиатуры (в jsdom у панелей нулевые размеры, и щелчки мышью
    // перехватывает обработчик разделителей панелей).
    codeTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tabpanel", { name: "Консоль" })).toHaveTextContent("Нет сообщений");

    const serial = within(tabs).getByRole("tab", { name: /Монитор порта/ });
    await user.keyboard("{ArrowRight}");
    expect(serial).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: /Монитор порта/ })).toHaveTextContent("Вывода пока нет");

    // «Проблемы» работает: проверка схемы идёт на backend.
    const problems = within(tabs).getByRole("tab", { name: /Проблемы/ });
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
    await renderApp();
    const editor = await screen.findByRole("textbox", { name: "Редактор кода скетча" });
    await screen.findByText("Сохранено");
    fireEvent.change(editor, { target: { value: "// изменено" } });
    expect(screen.getByText("Есть несохранённые изменения")).toBeInTheDocument();

    expect(fireEvent.keyDown(window, init)).toBe(false);
    expect(await screen.findByText("Сохранено")).toBeInTheDocument();
    const [stored] = server.projects.values();
    expect(stored?.code).toBe("// изменено");
  });

  it("Cmd+Enter saves the project and starts the simulation", async () => {
    await renderApp();
    const editor = await screen.findByRole("textbox", { name: "Редактор кода скетча" });
    await screen.findByText("Сохранено");
    fireEvent.change(editor, { target: { value: "void setup(){}\nvoid loop(){}\n" } });

    expect(fireEvent.keyDown(window, { key: "Enter", code: "Enter", metaKey: true })).toBe(false);

    const controls = screen.getByRole("group", { name: "Управление симуляцией" });
    await waitFor(() => {
      expect(within(controls).getByRole("status")).toHaveTextContent("Симуляция идёт");
    });
    // Сначала сохранение, затем запуск сохранённого проекта.
    const methods = server.requests.map((request) => `${request.method} ${request.url.replace(/[0-9a-f-]{36}/, "{id}")}`);
    expect(methods.slice(-2)).toEqual(["PATCH /api/v1/projects/{id}", "POST /api/v1/projects/{id}/simulation/start"]);
    expect(within(controls).getByRole("button", { name: "Пауза" })).toBeEnabled();
    expect(within(controls).getByRole("button", { name: "Остановить" })).toBeEnabled();
  });

  it("does not intercept other shortcuts", async () => {
    await renderApp();
    expect(fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "s", code: "KeyS" })).toBe(true);
  });
});
