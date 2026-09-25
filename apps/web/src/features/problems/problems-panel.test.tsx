import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CircuitValidationResponse } from "@/api/schemas";
import { CircuitValidationError } from "@/api/validation";
import { jsonResponse, stubFetch } from "@/test/fetch";
import { renderWithQueryClient } from "@/test/render";
import { useCircuitStore } from "@/stores/circuit-store";
import { useUiStore } from "@/stores/ui-store";

import { countIssues } from "./issue-format";
import { ProblemCountsBadge, ProblemsPanel } from "./problems-panel";
import { useCircuitValidation } from "./use-circuit-validation";

const RESULT: CircuitValidationResponse = {
  issues: [
    {
      code: "POWER_SHORT_TO_GROUND",
      severity: "ERROR",
      message: "Power output shorted to ground: uno1.5V, uno1.GND1.",
      refs: [
        { kind: "net", id: "NET_001" },
        { kind: "pin", id: "uno1.5V" },
      ],
      params: { pins: "uno1.5V, uno1.GND1" },
    },
    {
      code: "GPIO_CURRENT_EXCEEDS_LIMIT",
      severity: "WARNING",
      message: "Estimated current …",
      refs: [
        { kind: "pin", id: "uno1.D13" },
        { kind: "component", id: "r1" },
      ],
      params: { pin: "uno1.D13", direction: "source", currentMa: 30.5, limitMa: 20 },
    },
    {
      code: "SPI_PINS_USED",
      severity: "INFO",
      message: "Pins shared with SPI are used: uno1.D13.",
      refs: [{ kind: "pin", id: "uno1.D13" }],
      params: { pins: "D13" },
    },
  ],
  nets: [{ id: "NET_001", members: ["uno1.5V", "uno1.GND1"] }],
};

function renderPanel(props: Partial<Parameters<typeof ProblemsPanel>[0]> = {}) {
  return render(<ProblemsPanel data={RESULT} error={null} isFetching={false} onRetry={() => undefined} {...props} />);
}

describe("ProblemsPanel", () => {
  it("lists issues with severity as icon and text and localized messages", () => {
    renderPanel();
    const items = within(screen.getByRole("list", { name: "Проблемы схемы" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Ошибка");
    expect(items[0]).toHaveTextContent("Короткое замыкание: выход питания соединён с GND (uno1.5V, uno1.GND1).");
    expect(items[1]).toHaveTextContent("Предупреждение");
    expect(items[1]).toHaveTextContent("Оценка тока uno1.D13 (вывод отдаёт ток): 30,5 мА — больше рабочего предела 20 мА");
    expect(items[2]).toHaveTextContent("Сведения");
    expect(items[2]).toHaveTextContent("Выводы D13 используются также шиной SPI.");
  });

  it("selects and shows the referenced objects on click", async () => {
    const user = userEvent.setup();
    const r1 = useCircuitStore.getState().addComponent("resistor", { x: 20, y: 4 });
    expect(r1).toBe("r1");
    renderPanel();
    await user.click(screen.getByRole("button", { name: /Оценка тока uno1\.D13/ }));
    expect(useCircuitStore.getState().selection.componentIds).toEqual(["uno1", "r1"]);
    expect(useUiStore.getState().canvasFocus?.ids).toEqual(["uno1", "r1"]);
  });

  it("shows an empty state and a failure state with retry", async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel({ data: { issues: [], nets: [] } });
    expect(screen.getByText("Проблем не найдено.")).toBeInTheDocument();

    const onRetry = vi.fn();
    rerender(
      <ProblemsPanel
        data={undefined}
        error={new CircuitValidationError("unreachable", "down")}
        isFetching={false}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Не удалось проверить схему: сервер недоступен.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Проверить снова" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("summarizes counts for the tab badge", () => {
    render(<ProblemCountsBadge counts={countIssues(RESULT.issues)} />);
    expect(screen.getByLabelText("Ошибки: 1, предупреждения: 1, сведения: 1")).toHaveTextContent("11");
  });
});

function ValidationProbe() {
  const { data } = useCircuitValidation();
  return <p>{data === undefined ? "pending" : `issues: ${String(data.issues.length)}`}</p>;
}

describe("useCircuitValidation", () => {
  it("validates the current circuit after the debounce", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(RESULT, 200)));
    renderWithQueryClient(<ValidationProbe />);
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(await screen.findByText("issues: 3", undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/circuits/validate");
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toMatchObject({ schemaVersion: 1, board: { id: "uno1" } });
  });
});

describe("issueTargets", () => {
  it("selects the wires of a referenced net", async () => {
    const { issueTargets } = await import("./issue-format");
    const [short] = RESULT.issues;
    if (short === undefined) throw new Error("missing issue");
    const targets = issueTargets(short, RESULT.nets, {
      boardId: "uno1",
      component: () => true,
      connection: () => true,
      wires: [
        { id: "w1", from: "uno1.5V", to: "bb1.tp1" },
        { id: "w2", from: "r1.1", to: "uno1.D2" },
      ],
    });
    expect(targets).toEqual({ componentIds: ["uno1"], connectionIds: ["w1"] });
  });
});
