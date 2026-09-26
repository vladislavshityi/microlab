import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { getProject, updateProject } from "@/api/projects";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectStore } from "@/stores/project-store";
import { stubFetch } from "@/test/fetch";
import { FakeProjectsServer } from "@/test/projects-server";
import { renderWithQueryClient } from "@/test/render";

import { openProject } from "./project-session";
import { ProjectsMenu } from "./projects-menu";

let server: FakeProjectsServer;
let projectId: string;

beforeEach(async () => {
  server = new FakeProjectsServer();
  stubFetch((input, init) => server.handle(input as string, init));
  const project = server.add({ name: "Мигание", code: "// v1" });
  projectId = project.id;
  await updateProject(projectId, { revision: 1, code: "// v2" });
  openProject(await getProject(projectId));
});

describe("RevisionHistoryDialog", () => {
  it("lists revisions, previews code and restores an old one as a new revision", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ProjectsMenu />);

    await user.click(screen.getByRole("button", { name: "Проекты" }));
    await user.click(await screen.findByRole("menuitem", { name: "История версий…" }));

    expect(await screen.findByRole("button", { name: /Версия 2 · текущая/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Версия 1/ }));
    expect(await screen.findByLabelText("Код версии 1")).toHaveTextContent("// v1");

    await user.click(screen.getByRole("button", { name: "Восстановить" }));
    expect(await screen.findByText("Восстановить версию?")).toBeInTheDocument();
    const [confirm] = screen.getAllByRole("button", { name: "Восстановить" }).slice(-1);
    if (confirm === undefined) throw new Error("confirm button missing");
    await user.click(confirm);

    await waitFor(() => {
      expect(useProjectStore.getState().revision).toBe(3);
    });
    expect(server.projects.get(projectId)?.code).toBe("// v1");
    expect(useEditorStore.getState().code).toBe("// v1");
  });

  it("disables restore for the current revision", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ProjectsMenu />);
    await user.click(screen.getByRole("button", { name: "Проекты" }));
    await user.click(await screen.findByRole("menuitem", { name: "История версий…" }));
    await screen.findByLabelText("Код версии 2");
    expect(screen.getByRole("button", { name: "Восстановить" })).toBeDisabled();
  });
});
