import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ComponentsSidebar } from "./components-sidebar";

describe("ComponentsSidebar", () => {
  it("lists definitions from circuit-schema grouped by category", () => {
    render(<ComponentsSidebar />);

    const boards = screen.getByRole("region", { name: "Платы" });
    expect(within(boards).getByText("Arduino UNO R3")).toBeInTheDocument();

    const basic = screen.getByRole("region", { name: "Базовые" });
    const names = within(basic)
      .getAllByRole("listitem")
      .map((item) => item.firstElementChild?.textContent);
    expect(names).toEqual(["Светодиод", "Кнопка", "Резистор"]);

    // Пустые категории не показываются; добавление на схему честно помечено как недоступное.
    expect(screen.queryByRole("region", { name: "Датчики" })).not.toBeInTheDocument();
    expect(screen.getByText("Добавление на схему появится в следующей версии.")).toBeInTheDocument();
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
});
