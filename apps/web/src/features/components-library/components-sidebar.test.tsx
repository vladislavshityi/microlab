import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useCircuitStore } from "@/stores/circuit-store";
import { useUiStore } from "@/stores/ui-store";

import { ComponentsSidebar } from "./components-sidebar";

describe("ComponentsSidebar", () => {
  it("lists definitions from circuit-schema grouped by category", () => {
    render(<ComponentsSidebar />);

    const boards = screen.getByRole("region", { name: "Платы" });
    expect(within(boards).getByText("Arduino UNO R3")).toBeInTheDocument();

    const basic = screen.getByRole("region", { name: "Базовые" });
    const names = within(basic)
      .getAllByRole("button")
      .map((item) => item.getAttribute("aria-label"));
    expect(names).toEqual([
      "Добавить на схему: Светодиод",
      "Добавить на схему: Кнопка",
      "Добавить на схему: Резистор",
    ]);

    // Пустые категории не показываются; плата всегда на схеме и не добавляется повторно.
    expect(screen.queryByRole("region", { name: "Датчики" })).not.toBeInTheDocument();
    expect(within(boards).queryByRole("button")).not.toBeInTheDocument();
    expect(within(boards).getByText("На схеме")).toBeInTheDocument();
  });

  it("filters by name and shows an empty result", async () => {
    const user = userEvent.setup();
    render(<ComponentsSidebar />);
    const search = screen.getByRole("searchbox", { name: "Поиск компонентов" });

    await user.type(search, "рез");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Резистор")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "LED");
    expect(screen.getByText("Светодиод")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "осциллограф");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });

  it("adds a component at the canvas center on click and supports dragging", async () => {
    const user = userEvent.setup();
    useUiStore.getState().setCanvasCenter({ x: 30, y: 10 });
    render(<ComponentsSidebar />);

    await user.click(screen.getByRole("button", { name: "Добавить на схему: Резистор" }));
    const state = useCircuitStore.getState();
    expect(state.componentOrder).toEqual(["r1"]);
    // Центр символа 4×2 — в центре холста.
    expect(state.components["r1"]?.position).toEqual({ x: 28, y: 9 });
    expect(state.selection.componentIds).toEqual(["r1"]);

    // Повторное добавление не накладывается на первый компонент.
    await user.click(screen.getByRole("button", { name: "Добавить на схему: Резистор" }));
    expect(useCircuitStore.getState().components["r2"]?.position).toEqual({ x: 34, y: 9 });

    const item = screen.getByRole("button", { name: "Добавить на схему: Светодиод" });
    expect(item).toHaveAttribute("draggable", "true");
  });

  it("focuses the search field on request (A on the canvas)", () => {
    render(<ComponentsSidebar />);
    act(() => {
      useUiStore.getState().requestComponentSearch();
    });
    expect(screen.getByRole("searchbox", { name: "Поиск компонентов" })).toHaveFocus();
    expect(useUiStore.getState().componentSearchRequested).toBe(false);
  });
});
