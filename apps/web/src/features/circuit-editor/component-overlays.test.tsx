import { getComponentDefinition, type ComponentDefinition, type ComponentInstance } from "@microlab/circuit-schema";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { jsonResponse, stubFetch } from "@/test/fetch";
import { simulationInfo } from "@/test/projects-server";
import { useProjectStore } from "@/stores/project-store";
import { useSimulationStore } from "@/stores/simulation-store";

import { SimulationOverlay } from "./simulation-overlay";

const PROJECT_ID = "00000000-0000-4000-8000-000000000002";

function definition(type: string): ComponentDefinition {
  const found = getComponentDefinition(type);
  if (found === undefined) throw new Error(type);
  return found;
}

function renderOverlay(type: string, componentId: string, properties: ComponentInstance["properties"] = {}) {
  return render(
    <SimulationOverlay
      componentId={componentId}
      definition={definition(type)}
      rotation={0}
      properties={properties}
      widthPx={80}
      heightPx={60}
    />,
  );
}

function channel(on: boolean, brightness = 0.5) {
  return { on, brightness, currentMa: on ? 10 : 0 };
}

describe("component overlays", () => {
  let requests: unknown[];

  beforeEach(() => {
    requests = [];
    useProjectStore.setState({ phase: "ready", projectId: PROJECT_ID });
    useSimulationStore.setState({ phase: "running", components: {} });
    stubFetch((_input, init) => {
      requests.push(typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
      return Promise.resolve(jsonResponse({ session: simulationInfo(PROJECT_ID, "running"), appliedCycle: 1 }, 200));
    });
  });

  it("mixes the RGB LED color from channel brightness", () => {
    useSimulationStore.setState({
      components: { rgb1: { on: true, channels: { r: channel(true, 0.6), g: channel(true, 0.3), b: channel(false) } } },
    });
    renderOverlay("rgb-led", "rgb1");
    expect(screen.getByTestId("rgb-light-rgb1")).toHaveAttribute("data-rgb", "255, 128, 0");
  });

  it("lights the segments reported by the simulator", () => {
    useSimulationStore.setState({
      components: { seg1: { on: true, channels: { b: channel(true), c: channel(true), a: channel(false), dp: channel(true) } } },
    });
    renderOverlay("seven-segment", "seg1", { color: "green" });
    expect(screen.getByTestId("segments-seg1")).toHaveAttribute("data-lit", "bcdp");
  });

  it("turns the servo horn to the reported angle", () => {
    renderOverlay("servo", "servo1");
    expect(screen.getByTestId("servo-horn-servo1")).toHaveAttribute("data-angle", "");
    act(() => {
      useSimulationStore.setState({ components: { servo1: { angle: 45, powered: true } } });
    });
    expect(screen.getByTestId("servo-horn-servo1")).toHaveAttribute("data-angle", "45.0");
    expect(screen.getByText("45°")).toBeInTheDocument();
  });

  it("shows the buzzer frequency only while it sounds", () => {
    renderOverlay("piezo-buzzer", "bz1");
    expect(screen.queryByTestId("piezo-bz1")).not.toBeInTheDocument();
    act(() => {
      useSimulationStore.setState({ components: { bz1: { active: true, frequencyHz: 440.14 } } });
    });
    expect(screen.getByText("440.1 Гц")).toBeInTheDocument();
  });

  it("moves the potentiometer wiper with the keyboard during the simulation", async () => {
    renderOverlay("potentiometer", "pot1", { positionPercent: 50 });
    expect(screen.getByTestId("pot-wiper-pot1")).toHaveAttribute("data-position", "0.500");
    const slider = screen.getByRole("slider", { name: /Движок потенциометра pot1/ });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await waitFor(() => {
      expect(requests).toEqual([{ componentId: "pot1", input: { position: 0.55 } }]);
    });
    expect(screen.getByTestId("pot-wiper-pot1")).toHaveAttribute("data-position", "0.550");
  });

  it("shows the wiper from the properties and no control when stopped", () => {
    useSimulationStore.setState({ phase: "idle" });
    renderOverlay("potentiometer", "pot1", { positionPercent: 20 });
    expect(screen.getByTestId("pot-wiper-pot1")).toHaveAttribute("data-position", "0.200");
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});
