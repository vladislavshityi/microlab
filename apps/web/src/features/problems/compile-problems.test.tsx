import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COMPILATION } from "@/test/projects-server";
import { useEditorStore } from "@/stores/editor-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useUiStore } from "@/stores/ui-store";

import { CompileProblems } from "./compile-problems";

describe("CompileProblems", () => {
  it("lists compiler diagnostics and jumps to the line", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    useSimulationStore.setState({
      compilation: {
        ...COMPILATION,
        status: "error",
        diagnostics: [
          { file: "sketch.ino", line: 5, column: 3, severity: "error", message: "'foo' was not declared in this scope" },
          { file: null, line: null, column: null, severity: "error", message: "compilation failed" },
        ],
      },
    });
    render(<CompileProblems />);

    expect(screen.getByText("sketch.ino:5:3")).toBeInTheDocument();
    expect(screen.getByText("compilation failed").closest("button")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Перейти к sketch.ino:5:3/ }));
    expect(useUiStore.getState().bottomTab).toBe("code");
    expect(useEditorStore.getState().reveal).toMatchObject({ line: 5, column: 3 });
  });
});
