import { getComponentDefinition, type ComponentDefinition } from "@microlab/circuit-schema";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { jsonResponse, stubFetch } from "@/test/fetch";
import { simulationInfo } from "@/test/projects-server";
import { useProjectStore } from "@/stores/project-store";
import { useSimulationStore } from "@/stores/simulation-store";

import { SimulationOverlay } from "./simulation-overlay";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

function definition(type: string): ComponentDefinition {
  const found = getComponentDefinition(type);
  if (found === undefined) throw new Error(type);
  return found;
}

function renderOverlay(type: string, componentId: string) {
  return render(
    <SimulationOverlay
      componentId={componentId}
      definition={definition(type)}
      rotation={0}
      properties={{ color: "green" }}
      widthPx={80}
      heightPx={40}
    />,
  );
}

describe("SimulationOverlay", () => {
  let requests: { url: string; body: unknown }[];

  beforeEach(() => {
    requests = [];
    useProjectStore.setState({ phase: "ready", projectId: PROJECT_ID });
    stubFetch((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      return Promise.resolve(jsonResponse({ session: simulationInfo(PROJECT_ID, "running"), appliedCycle: 1 }, 200));
    });
  });

  it("sends button presses with the mouse while the simulation runs", async () => {
    useSimulationStore.setState({ phase: "running" });
    renderOverlay("push-button", "button1");
    const button = screen.getByRole("button", { name: /Нажать кнопку button1/ });

    fireEvent.pointerDown(button, { button: 0 });
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerUp(button, { button: 0 });
    fireEvent.pointerLeave(button);

    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    expect(requests.map((request) => request.url)).toEqual([
      `/api/v1/projects/${PROJECT_ID}/simulation/input`,
      `/api/v1/projects/${PROJECT_ID}/simulation/input`,
    ]);
    expect(requests.map((request) => request.body)).toEqual([
      { componentId: "button1", input: { pressed: true } },
      { componentId: "button1", input: { pressed: false } },
    ]);
  });

  it("presses with Space while focused", async () => {
    useSimulationStore.setState({ phase: "paused" });
    renderOverlay("push-button", "button1");
    const button = screen.getByRole("button", { name: /Нажать кнопку button1/ });
    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyDown(button, { key: " ", repeat: true });
    fireEvent.keyUp(button, { key: " " });
    await waitFor(() => {
      expect(requests.map((request) => request.body)).toEqual([
        { componentId: "button1", input: { pressed: true } },
        { componentId: "button1", input: { pressed: false } },
      ]);
    });
  });

  it("is not pressable without an active simulation", () => {
    renderOverlay("push-button", "button1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lights the LED by the simulated brightness", () => {
    const { container } = renderOverlay("led", "led1");
    expect(container.querySelector("[data-testid='led-light-led1']")).toBeNull();
    act(() => {
      useSimulationStore.setState({ components: { led1: { on: true, brightness: 0.5, currentMa: 10 } } });
    });
    expect(screen.getByTestId("led-light-led1")).toHaveAttribute("data-brightness", "0.50");
  });

  it("shows the built-in LED of the board from the D13 level", () => {
    renderOverlay("arduino-uno-r3", "uno1");
    expect(screen.getByTestId("builtin-led")).toHaveAttribute("data-level", "0.00");
    act(() => {
      useSimulationStore.setState({ pins: { D13: { mode: "output-high", value: 1, dutyCycle: null } } });
    });
    expect(screen.getByTestId("builtin-led")).toHaveAttribute("data-level", "1.00");
  });
});
