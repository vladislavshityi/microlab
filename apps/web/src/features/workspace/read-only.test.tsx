import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { openProject, resetProjectSession } from "@/features/projects/project-session";
import { useCircuitStore } from "@/stores/circuit-store";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectStore } from "@/stores/project-store";
import { renderWithQueryClient } from "@/test/render";

import { ReadOnlyBanner } from "./read-only-banner";

const PROJECT = {
  id: "p1",
  name: "Мигалка",
  description: "",
  board: "arduino-uno-r3",
  schemaVersion: 1,
  revision: 2,
  createdAt: "2026-09-26T10:00:00Z",
  updatedAt: "2026-09-26T10:00:00Z",
  owner: { id: "s1", displayName: "Иван Иванов" },
  access: "viewer",
  code: "void setup() {}\nvoid loop() {}\n",
  circuit: {
    schemaVersion: 1,
    board: { id: "uno1", type: "arduino-uno-r3" },
    components: [],
    connections: [],
  },
} as const;

afterEach(() => {
  resetProjectSession();
  useCircuitStore.getState().setReadOnly(false);
  useEditorStore.setState({ readOnly: false });
  useProjectStore.setState({ readOnly: null });
});

describe("read-only project view", () => {
  it("blocks edits and shows the owner", () => {
    expect(openProject({ ...PROJECT })).toBe(true);
    expect(useProjectStore.getState().readOnly).toEqual({ ownerName: "Иван Иванов" });

    useCircuitStore.getState().addComponent("resistor", { x: 0, y: 0 });
    expect(useCircuitStore.getState().componentOrder).toEqual([]);
    useEditorStore.getState().setCode("// правка");
    expect(useEditorStore.getState().code).toBe(PROJECT.code);
    expect(useProjectStore.getState().status).toBe("saved");

    renderWithQueryClient(<ReadOnlyBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Только просмотр — проект студента Иван Иванов");
  });

  it("keeps own projects editable", () => {
    openProject({ ...PROJECT, access: "owner" });
    expect(useProjectStore.getState().readOnly).toBeNull();
    useEditorStore.getState().setCode("// правка");
    expect(useEditorStore.getState().code).toBe("// правка");
  });
});
