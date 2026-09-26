import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { jsonResponse, stubFetch } from "@/test/fetch";
import { simulationInfo } from "@/test/projects-server";
import { useProjectStore } from "@/stores/project-store";
import { useSimulationStore } from "@/stores/simulation-store";

import { SerialMonitor } from "./serial-monitor";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

function renderMonitor() {
  return render(
    <TooltipProvider>
      <SerialMonitor />
    </TooltipProvider>,
  );
}

function emitSerial(text: string, timestamp = 1000) {
  act(() => {
    useSimulationStore.getState().applyMessage({
    version: 1,
    type: "event_batch",
    timestamp,
      events: [{ version: 1, type: "serial_output", timestamp, payload: { port: "Serial", bytes: [...new TextEncoder().encode(text)] } }],
    });
  });
}

/** В jsdom нет раскладки: размеры прокрутки задаются вручную. */
function setScrollGeometry(element: HTMLElement, geometry: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: geometry.scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: geometry.clientHeight });
}

describe("SerialMonitor", () => {
  let bodies: unknown[];

  beforeEach(() => {
    bodies = [];
    useProjectStore.setState({ phase: "ready", projectId: PROJECT_ID });
    stubFetch((_input, init) => {
      bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
      return Promise.resolve(jsonResponse({ session: simulationInfo(PROJECT_ID, "running"), appliedCycle: 1 }, 200));
    });
  });

  it("appends output and clears it", async () => {
    const user = userEvent.setup();
    renderMonitor();
    expect(screen.getByTestId("serial-output")).toHaveTextContent("Вывода пока нет");
    emitSerial("on\r\n");
    emitSerial("off\r\n");
    expect(screen.getByTestId("serial-output").textContent).toBe("on\noff\n");

    await user.click(screen.getByRole("button", { name: "Очистить вывод" }));
    expect(screen.getByTestId("serial-output")).toHaveTextContent("Вывода пока нет");
  });

  it("follows new output until the user scrolls up", () => {
    renderMonitor();
    const output = screen.getByTestId("serial-output");
    setScrollGeometry(output, { scrollHeight: 500, clientHeight: 100 });
    emitSerial("a\n");
    expect(output.scrollTop).toBe(500);

    // Прокрутка вверх останавливает автопрокрутку.
    output.scrollTop = 100;
    fireEvent.scroll(output);
    setScrollGeometry(output, { scrollHeight: 600, clientHeight: 100 });
    emitSerial("b\n", 2000);
    expect(output.scrollTop).toBe(100);

    fireEvent.click(screen.getByRole("button", { name: "К концу" }));
    expect(output.scrollTop).toBe(600);
  });

  it("sends input with the selected line ending while the simulation runs", async () => {
    const user = userEvent.setup();
    renderMonitor();
    const input = screen.getByRole("textbox", { name: "Данные для отправки в Serial" });
    expect(input).toBeDisabled();

    act(() => {
      useSimulationStore.setState({ phase: "running" });
    });
    await user.type(input, "ping");
    await user.selectOptions(screen.getByRole("combobox", { name: "Окончание строки" }), "crlf");
    await user.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(bodies).toEqual([{ data: "ping\r\n" }]);
    });
    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });
});
