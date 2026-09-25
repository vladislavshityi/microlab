import breadboardLed from "@microlab/circuit-schema/examples/breadboard-led.json";
import { getComponentDefinition } from "@microlab/circuit-schema";
import { describe, expect, it } from "vitest";

import { normalizeCircuit, parseCircuitDocument } from "@/features/circuit-model/circuit-document";
import { GRID_PX } from "@/features/circuit-model/geometry";

import { holeAtClientPoint, occupiedHoles, socketLayout } from "./breadboard";

const definition = getComponentDefinition("breadboard");
if (definition === undefined) throw new Error("breadboard definition missing");

describe("breadboard geometry", () => {
  it("groups holes into strips: a–e, f–j and continuous rails", () => {
    const layout = socketLayout(definition, 0);
    expect(layout.groupOf.get("c7")).toEqual(["a7", "b7", "c7", "d7", "e7"]);
    expect(layout.groupOf.get("f7")).not.toContain("e7");
    expect(layout.groupOf.get("tp1")).toHaveLength(25);
    expect(layout.groupOf.get("tp1")).toContain("tp25");
  });

  it("finds the hole under a screen point, taking rotation into account", () => {
    const rect = { left: 100, top: 50, width: 33 * GRID_PX, height: 19 * GRID_PX };
    // a1 — локальная точка (2, 4).
    expect(holeAtClientPoint(definition, 0, rect, 100 + 2 * GRID_PX, 50 + 4 * GRID_PX)).toBe("a1");
    // Между отверстиями — ничего.
    expect(holeAtClientPoint(definition, 0, rect, 100 + 2.5 * GRID_PX, 50 + 4 * GRID_PX)).toBeUndefined();
    // Поворот 90: (x, y) → (19 − y, x), a1 → (15, 2).
    const rotated = { left: 0, top: 0, width: 19 * GRID_PX, height: 33 * GRID_PX };
    expect(holeAtClientPoint(definition, 90, rotated, 15 * GRID_PX, 2 * GRID_PX)).toBe("a1");
  });

  it("marks holes with plugged pins and wire ends as occupied", () => {
    const circuit = normalizeCircuit(parseCircuitDocument(structuredClone(breadboardLed)));
    expect(occupiedHoles(circuit).get("bb1")?.split(" ")).toEqual(["a5", "bn1", "bn6", "c5", "c9", "d9", "f9", "j9"]);
  });
});
