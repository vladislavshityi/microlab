import { describe, expect, it } from "vitest";

import type { SimulationPhase } from "@/stores/simulation-store";

import { controlAvailability, formatSimulatedTime } from "./controls";

describe("controlAvailability", () => {
  it.each<[SimulationPhase, string]>([
    ["idle", "run"],
    ["validating", ""],
    ["compiling", ""],
    ["starting", ""],
    ["running", "run pause stop reset"],
    ["paused", "run resume stop reset"],
    ["stopped", "run"],
    ["error", "run"],
  ])("%s → %s", (phase, expected) => {
    const available = controlAvailability(phase, true);
    const enabled = (["run", "pause", "resume", "stop", "reset"] as const).filter((name) => available[name]);
    expect(enabled.join(" ")).toBe(expected);
  });

  it("does not allow running without an open project", () => {
    expect(controlAvailability("idle", false).run).toBe(false);
  });
});

describe("formatSimulatedTime", () => {
  it("shows seconds with millisecond precision", () => {
    expect(formatSimulatedTime(12_345_678)).toBe("t = 12,346 с");
    expect(formatSimulatedTime(0)).toBe("t = 0,000 с");
  });
});
