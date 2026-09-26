import { beforeEach, describe, expect, it } from "vitest";

import type { SimulationEvent, SessionState } from "@/features/simulation/events";

import { appendSerial, builtinLedLevel, SERIAL_MAX_CHARS, useSimulationStore } from "./simulation-store";

function ev(type: string, timestamp: number, payload: Record<string, unknown> = {}): SimulationEvent {
  return { version: 1, type, timestamp, payload };
}

function batch(timestamp: number, events: SimulationEvent[]) {
  useSimulationStore.getState().applyMessage({ version: 1, type: "event_batch", timestamp, events });
}

function session(simulationId: string, status: "running" | "paused" | "stopped" | "failed" | "starting"): SessionState["session"] {
  return {
    simulationId,
    projectId: "p1",
    status,
    startTime: "2026-09-26T10:00:00Z",
    endTime: null,
    errorCode: null,
    timestamp: 5000,
    cycle: 80_000,
  };
}

const LED_ON = ev("component_state_changed", 10_000, {
  componentId: "led1",
  state: { on: true, brightness: 0.57, currentMa: 11.5 },
});

describe("simulationStore event batches", () => {
  beforeEach(() => {
    useSimulationStore.getState().resetForProject();
  });

  it("applies pin, component and time changes in one update", () => {
    let updates = 0;
    const unsubscribe = useSimulationStore.subscribe(() => {
      updates += 1;
    });
    batch(10_000, [
      ev("simulation_started", 0),
      ev("digital_pin_changed", 10_000, { pin: "D13", mode: "output-high", value: 1 }),
      LED_ON,
    ]);
    unsubscribe();

    const state = useSimulationStore.getState();
    expect(updates).toBe(1);
    expect(state.phase).toBe("running");
    expect(state.timeUs).toBe(10_000);
    expect(state.pins["D13"]).toEqual({ mode: "output-high", value: 1, dutyCycle: null });
    expect(state.components["led1"]).toEqual({ on: true, brightness: 0.57, currentMa: 11.5 });
  });

  it("keeps the identity of components that did not change", () => {
    batch(10_000, [LED_ON, ev("component_state_changed", 10_000, { componentId: "button1", state: { pressed: false } })]);
    const button = useSimulationStore.getState().components["button1"];
    batch(20_000, [ev("component_state_changed", 20_000, { componentId: "led1", state: { on: false, brightness: 0 } })]);
    const state = useSimulationStore.getState();
    expect(state.components["button1"]).toBe(button);
    expect(state.components["led1"]?.on).toBe(false);
  });

  it("parses channels, inputs and behavioral states of additional components", () => {
    batch(10_000, [
      ev("component_state_changed", 10_000, {
        componentId: "rgb1",
        state: { on: true, channels: { r: { on: true, brightness: 2, currentMa: 11.5 }, g: { bad: 1 } } },
      }),
      ev("component_state_changed", 10_000, { componentId: "pot1", state: { position: 0.25 } }),
      ev("component_state_changed", 10_000, { componentId: "bz1", state: { active: true, frequencyHz: 440.14 } }),
      ev("component_state_changed", 10_000, { componentId: "s1", state: { powered: true, angle: null } }),
    ]);
    const { components } = useSimulationStore.getState();
    expect(components["rgb1"]?.channels).toEqual({ r: { on: true, brightness: 1, currentMa: 11.5 } });
    expect(components["pot1"]?.position).toBe(0.25);
    expect(components["bz1"]).toEqual({ active: true, frequencyHz: 440.14 });
    expect(components["s1"]).toEqual({ powered: true, angle: null });
  });

  it("records PWM duty cycle for the pin", () => {
    batch(1000, [
      ev("digital_pin_changed", 1000, { pin: "D9", mode: "pwm", value: 1 }),
      ev("pwm_changed", 1000, { pin: "D9", dutyCycle: 0.5, frequencyHz: 490 }),
    ]);
    const pin = useSimulationStore.getState().pins["D9"];
    expect(pin).toEqual({ mode: "pwm", value: 1, dutyCycle: 0.5 });
    expect(builtinLedLevel(pin)).toBe(0.5);
    expect(builtinLedLevel({ mode: "output-high", value: 1, dutyCycle: null })).toBe(1);
    expect(builtinLedLevel({ mode: "input-pullup", value: 1, dutyCycle: null })).toBe(0);
  });

  it("decodes serial output across batches", () => {
    batch(1000, [ev("serial_output", 1000, { port: "Serial", bytes: [0x6f, 0x6e, 0x0d, 0x0a, 0xd0] })]);
    batch(2000, [ev("serial_output", 2000, { port: "Serial", bytes: [0x9f, 0x07] })]);
    expect(useSimulationStore.getState().serialText).toBe("on\nП\\x07");
  });

  it("bounds the serial text by dropping the oldest lines", () => {
    const line = `${"x".repeat(99)}\n`;
    const text = appendSerial("", line.repeat(SERIAL_MAX_CHARS / 100 + 10));
    expect(text.length).toBeLessThanOrEqual(SERIAL_MAX_CHARS);
    expect(text.startsWith("x")).toBe(true);
  });

  it("pauses, resumes and clears the hardware state on stop", () => {
    batch(0, [ev("simulation_started", 0), LED_ON]);
    batch(1000, [ev("simulation_paused", 1000, { reason: "client" })]);
    expect(useSimulationStore.getState().phase).toBe("paused");
    batch(1000, [ev("simulation_resumed", 1000)]);
    expect(useSimulationStore.getState().phase).toBe("running");
    batch(2000, [ev("simulation_stopped", 2000, { reason: "client" })]);
    const state = useSimulationStore.getState();
    expect(state.phase).toBe("stopped");
    expect(state.components).toEqual({});
    expect(state.console.map((entry) => (entry.kind === "message" ? entry.key : "output"))).toEqual([
      "console.sim.started",
      "console.sim.paused",
      "console.sim.resumed",
      "console.sim.stopped",
    ]);
  });

  it("ends in error when the simulator fails", () => {
    batch(0, [ev("simulation_started", 0)]);
    batch(1000, [
      ev("simulation_error", 1000, { code: "WORKER_EXITED", severity: "error", message: "worker exited" }),
      ev("simulation_stopped", 1000, { reason: "worker_failed" }),
    ]);
    const state = useSimulationStore.getState();
    expect(state.phase).toBe("error");
    expect(state.errorCode).toBe("WORKER_EXITED");
    expect(state.runtimeIssues[0]?.code).toBe("WORKER_EXITED");
  });

  it("records runtime warnings with their subject", () => {
    batch(0, [ev("simulation_error", 0, { code: "FLOATING_INPUT", severity: "warning", pin: "D2", message: "x" })]);
    const [issue] = useSimulationStore.getState().runtimeIssues;
    expect(issue).toMatchObject({ code: "FLOATING_INPUT", severity: "warning", subject: "D2" });
    expect(useSimulationStore.getState().phase).toBe("idle");
  });

  it("ignores lifecycle events of the previous session while a run is pending", () => {
    const store = useSimulationStore.getState();
    batch(0, [ev("simulation_started", 0)]);
    store.beginRun();
    store.setPhase("compiling");
    batch(1000, [ev("simulation_stopped", 1000, { reason: "client" })]);
    expect(useSimulationStore.getState().phase).toBe("compiling");

    store.applyMessage({ version: 1, type: "session_state", session: session("new", "starting"), events: [], serialTail: [] });
    expect(useSimulationStore.getState().phase).toBe("starting");
    batch(0, [ev("simulation_started", 0)]);
    expect(useSimulationStore.getState().phase).toBe("running");
  });
});

describe("simulationStore session state", () => {
  beforeEach(() => {
    useSimulationStore.getState().resetForProject();
  });

  it("adopts a new session with its snapshot and serial tail", () => {
    useSimulationStore.getState().applyMessage({
      version: 1,
      type: "session_state",
      session: session("s1", "running"),
      events: [LED_ON, ev("digital_pin_changed", 0, { pin: "D13", mode: "output-high", value: 1 })],
      serialTail: [0x68, 0x69, 0x0a],
    });
    const state = useSimulationStore.getState();
    expect(state.simulationId).toBe("s1");
    expect(state.phase).toBe("running");
    expect(state.timeUs).toBe(5000);
    expect(state.components["led1"]?.on).toBe(true);
    expect(state.serialText).toBe("hi\n");
  });

  it("keeps the serial log when reconnecting to the same session", () => {
    const store = useSimulationStore.getState();
    store.applyMessage({ version: 1, type: "session_state", session: session("s1", "running"), events: [], serialTail: [0x61] });
    batch(6000, [ev("serial_output", 6000, { port: "Serial", bytes: [0x62] })]);
    store.applyMessage({ version: 1, type: "session_state", session: session("s1", "paused"), events: [], serialTail: [0x62] });
    const state = useSimulationStore.getState();
    expect(state.serialText).toBe("ab");
    expect(state.phase).toBe("paused");
  });

  it("shows a finished last session without hardware state", () => {
    useSimulationStore.getState().applyMessage({
      version: 1,
      type: "session_state",
      session: session("s1", "stopped"),
      events: [LED_ON],
      serialTail: [],
    });
    const state = useSimulationStore.getState();
    expect(state.phase).toBe("stopped");
    expect(state.components).toEqual({});
  });
});
