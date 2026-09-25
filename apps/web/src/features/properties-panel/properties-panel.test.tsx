import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useCircuitStore } from "@/stores/circuit-store";

import { PropertiesPanel } from "./properties-panel";

const store = () => useCircuitStore.getState();

describe("PropertiesPanel", () => {
  it("shows the empty state without a selection", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText("Ничего не выбрано")).toBeInTheDocument();
  });

  it("edits resistance with units and standard values", async () => {
    const user = userEvent.setup();
    const r1 = store().addComponent("resistor", { x: 20, y: 4 });
    render(<PropertiesPanel />);

    expect(screen.getByRole("heading", { name: "Резистор" })).toBeInTheDocument();
    expect(screen.getByText(r1)).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "Сопротивление" });
    expect(input).toHaveValue("220 Ω");

    await user.clear(input);
    await user.type(input, "4,7 кОм{Enter}");
    expect(store().components[r1]?.properties["resistanceOhms"]).toBe(4700);
    expect(screen.getByRole("textbox", { name: "Сопротивление" })).toHaveValue("4,7 kΩ");

    await user.clear(screen.getByRole("textbox", { name: "Сопротивление" }));
    await user.type(screen.getByRole("textbox", { name: "Сопротивление" }), "1M");
    await user.tab();
    expect(store().components[r1]?.properties["resistanceOhms"]).toBe(1_000_000);

    const presets = screen.getByRole("group", { name: "Стандартные значения: Сопротивление" });
    await user.click(within(presets).getByRole("button", { name: "10 kΩ" }));
    expect(store().components[r1]?.properties["resistanceOhms"]).toBe(10_000);
    expect(within(presets).getByRole("button", { name: "10 kΩ" })).toHaveAttribute("aria-pressed", "true");

    // Одна правка — один шаг отмены.
    store().undo();
    expect(store().components[r1]?.properties["resistanceOhms"]).toBe(1_000_000);
  });

  it("rejects unparsable and out-of-range values without changing the model", async () => {
    const user = userEvent.setup();
    const r1 = store().addComponent("resistor", { x: 20, y: 4 });
    render(<PropertiesPanel />);
    const input = screen.getByRole("textbox", { name: "Сопротивление" });

    await user.clear(input);
    await user.type(input, "abc{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Не удалось распознать значение");
    expect(input).toHaveAttribute("aria-invalid", "true");

    await user.clear(input);
    await user.type(input, "0{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("вне диапазона");
    expect(store().components[r1]?.properties["resistanceOhms"]).toBe(220);

    await user.keyboard("{Escape}");
    expect(input).toHaveValue("220 Ω");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("labels properties the simulator ignores", () => {
    store().addComponent("resistor", { x: 20, y: 4 });
    render(<PropertiesPanel />);
    const tolerance = screen.getByRole("textbox", { name: "Допуск" });
    expect(tolerance).toHaveAccessibleDescription(/Не моделируется — только для документации/);
    const resistance = screen.getByRole("textbox", { name: "Сопротивление" });
    expect(resistance).not.toHaveAccessibleDescription(/Не моделируется/);
  });

  it("edits enum properties (LED colour)", async () => {
    const user = userEvent.setup();
    const led1 = store().addComponent("led", { x: 20, y: 4 });
    render(<PropertiesPanel />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Цвет" }), "Зелёный");
    expect(store().components[led1]?.properties["color"]).toBe("green");
  });

  it("shows the board pin list read-only, without delete", () => {
    store().select({ componentIds: ["uno1"], connectionIds: [] });
    render(<PropertiesPanel />);
    const table = screen.getByRole("table", { name: "Выводы платы" });
    expect(within(table).getByRole("row", { name: /D13.*Цифровой вход\/выход.*PB5/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("creates a connection from pin lists (keyboard alternative to dragging)", async () => {
    const user = userEvent.setup();
    const r1 = store().addComponent("resistor", { x: 20, y: 4 });
    render(<PropertiesPanel />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Вывод" }), "2");
    await user.selectOptions(screen.getByRole("combobox", { name: "Соединить с выводом" }), "uno1.D13");
    await user.click(screen.getByRole("button", { name: "Соединить" }));
    expect(store().connections["w1"]).toMatchObject({
      from: { componentId: r1, pinId: "2" },
      to: { componentId: "uno1", pinId: "D13" },
    });
  });

  it("shows wire endpoints and changes the wire colour", async () => {
    const user = userEvent.setup();
    store().connect({ componentId: "uno1", pinId: "D13" }, { componentId: "uno1", pinId: "GND3" });
    render(<PropertiesPanel />);
    expect(screen.getByText("uno1.D13")).toBeInTheDocument();
    expect(screen.getByText("uno1.GND3")).toBeInTheDocument();

    const colors = screen.getByRole("radiogroup", { name: "Цвет провода" });
    expect(within(colors).getByRole("radio", { name: "По умолчанию" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(colors).getByRole("radio", { name: "Красный" }));
    expect(store().connections["w1"]?.color).toBe("#dc2626");
    expect(within(colors).getByRole("radio", { name: "Красный" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(store().connectionOrder).toEqual([]);
    expect(screen.getByText("Ничего не выбрано")).toBeInTheDocument();
  });
});
