import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeWebSocket } from "@/test/fake-websocket";
import { useSimulationStore } from "@/stores/simulation-store";

import { connectSimulationStream, RECONNECT_DELAYS_MS } from "./use-simulation-stream";

describe("connectSimulationStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects to the project stream and applies messages", () => {
    const disconnect = connectSimulationStream("p1");
    const socket = FakeWebSocket.latest();
    expect(socket?.url).toBe(`ws://${window.location.host}/api/v1/ws/projects/p1/simulation`);

    socket?.emit({
      version: 1,
      type: "event_batch",
      timestamp: 20,
      events: [{ version: 1, type: "digital_pin_changed", timestamp: 20, payload: { pin: "D13", mode: "output-high", value: 1 } }],
    });
    socket?.emit({ unexpected: true });
    expect(useSimulationStore.getState().pins["D13"]?.value).toBe(1);

    disconnect();
    expect(socket?.closedByClient).toBe(true);
  });

  it("reconnects after an unexpected close, but not after a final close", () => {
    const disconnect = connectSimulationStream("p1");
    FakeWebSocket.latest()?.serverClose(1006);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.latest()?.serverClose(4404);
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    disconnect();
  });
});
