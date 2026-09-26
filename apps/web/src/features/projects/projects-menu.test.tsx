import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { getProject } from "@/api/projects";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectStore } from "@/stores/project-store";
import { stubFetch } from "@/test/fetch";
import { FakeProjectsServer } from "@/test/projects-server";
import { renderWithQueryClient } from "@/test/render";

import { ConflictDialog } from "./conflict-dialog";
import { openProject, saveNow, startProjectSession } from "./project-session";
import { ProjectName } from "./project-name";
import { ProjectsMenu } from "./projects-menu";

let server: FakeProjectsServer;

function renderMenu() {
  return renderWithQueryClient(
    <>
      <ProjectName />
      <ProjectsMenu />
      <ConflictDialog />
    </>,
  );
}

beforeEach(async () => {
  server = new FakeProjectsServer();
  stubFetch((input, init) => server.handle(input as string, init));
  const first = server.add({ name: "Первый", code: "// first" });
  openProject(await getProject(first.id));
});

describe("ProjectsMenu", () => {
  it("creates a new project after saving the current one", async () => {
    const stop = startProjectSession();
    const user = userEvent.setup();
    renderMenu();
    useEditorStore.getState().setCode("// edited");

    await user.click(screen.getByRole("button", { name: "Проекты" }));
    await user.click(await screen.findByRole("menuitem", { name: "Новый проект" }));

    await waitFor(() => {
      expect(server.projects.size).toBe(2);
    });
    await screen.findByRole("button", { name: "Переименовать проект: Новый проект" });
    const first = [...server.projects.values()].find((p) => p.name === "Первый");
    expect(first?.code).toBe("// edited");
    stop();
  });

  it("lists and opens projects", async () => {
    const other = server.add({ name: "Второй", code: "// second" });
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Проекты" }));
    await user.click(await screen.findByRole("menuitem", { name: "Открыть проект…" }));
    const dialog = await screen.findByRole("dialog", { name: "Проекты" });
    await user.click(await within(dialog).findByRole("button", { name: "Открыть проект Второй" }));

    await waitFor(() => {
      expect(useProjectStore.getState().projectId).toBe(other.id);
    });
    expect(useEditorStore.getState().code).toBe("// second");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes the current project only after confirmation", async () => {
    const user = userEvent.setup();
    renderMenu();
    const firstId = useProjectStore.getState().projectId ?? "";

    await user.click(screen.getByRole("button", { name: "Проекты" }));
    await user.click(await screen.findByRole("menuitem", { name: "Удалить текущий проект…" }));
    const confirm = await screen.findByRole("dialog", { name: "Удалить проект?" });
    expect(confirm).toHaveTextContent("Первый");
    await user.click(within(confirm).getByRole("button", { name: "Отмена" }));
    expect(server.projects.has(firstId)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Проекты" }));
    await user.click(await screen.findByRole("menuitem", { name: "Удалить текущий проект…" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Удалить проект?" })).getByRole("button", {
        name: "Удалить",
      }),
    );
    await waitFor(() => {
      expect(server.projects.has(firstId)).toBe(false);
    });
    // Последний проект удалён — создан и открыт новый.
    await waitFor(() => {
      expect(useProjectStore.getState().name).toBe("Новый проект");
    });
  });

  it("renames the project inline", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Переименовать проект: Первый" }));
    const input = screen.getByRole("textbox", { name: "Название проекта" });
    await user.clear(input);
    await user.type(input, "Светофор{Enter}");
    await waitFor(() => {
      expect([...server.projects.values()][0]?.name).toBe("Светофор");
    });
  });

  it("shows the conflict dialog with explicit choices", async () => {
    const stop = startProjectSession();
    const user = userEvent.setup();
    renderMenu();
    const id = useProjectStore.getState().projectId ?? "";
    server.touch(id, { code: "// other" });
    useEditorStore.getState().setCode("// mine");
    await saveNow();

    const dialog = await screen.findByRole("dialog", { name: "Проект изменён в другом окне" });
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Загрузить версию с сервера/ }));
    await waitFor(() => {
      expect(useEditorStore.getState().code).toBe("// other");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    stop();
  });
});
