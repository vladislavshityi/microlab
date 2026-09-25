import { getComponentDefinition } from "@microlab/circuit-schema";
import externalLed from "@microlab/circuit-schema/examples/external-led.json";
import { describe, expect, it } from "vitest";

import { normalizeCircuit, parseCircuitDocument } from "./circuit-document";
import { collectIds, idPrefixForType, nextId } from "./ids";
import { GRID_PX, pinDirection, resolvePin, rotatePoint, worldToGrid } from "./geometry";

describe("geometry", () => {
  it("converts between world pixels and integer grid units deterministically", () => {
    expect(worldToGrid({ x: 3 * GRID_PX + 9, y: -2 * GRID_PX - 11 })).toEqual({ x: 3, y: -3 });
    expect(Object.is(worldToGrid({ x: -1, y: 0 }).x, 0)).toBe(true);
  });

  it("rotates pin positions clockwise inside the rotated bounding box", () => {
    const size = { width: 4, height: 2 };
    expect(rotatePoint({ x: 0, y: 1 }, size, 90)).toEqual({ x: 1, y: 0 });
    expect(rotatePoint({ x: 4, y: 1 }, size, 90)).toEqual({ x: 1, y: 4 });
    expect(rotatePoint({ x: 0, y: 1 }, size, 180)).toEqual({ x: 4, y: 1 });
    expect(rotatePoint({ x: 0, y: 1 }, size, 270)).toEqual({ x: 1, y: 4 });
  });

  it("resolves absolute pin positions and exit directions of the reference circuit", () => {
    const circuit = normalizeCircuit(parseCircuitDocument(structuredClone(externalLed)));
    expect(resolvePin(circuit, "uno1", "D13")).toEqual({ point: { x: 12, y: 6 }, direction: "right" });
    expect(resolvePin(circuit, "resistor1", "1")).toEqual({ point: { x: 20, y: 9 }, direction: "left" });
    // Светодиод повёрнут на 90°: анод сверху, катод снизу.
    expect(resolvePin(circuit, "led1", "A")).toEqual({ point: { x: 29, y: 8 }, direction: "up" });
    expect(resolvePin(circuit, "led1", "K")).toEqual({ point: { x: 29, y: 12 }, direction: "down" });
    expect(resolvePin(circuit, "led1", "X")).toBeUndefined();
    expect(resolvePin(circuit, "nope", "A")).toBeUndefined();
  });

  it("derives pin directions from the definition", () => {
    const board = getComponentDefinition("arduino-uno-r3");
    expect(board).toBeDefined();
    if (board === undefined) return;
    expect(pinDirection(board, "A0", 0)).toBe("left");
    expect(pinDirection(board, "D2", 0)).toBe("right");
    expect(pinDirection(board, "D2", 180)).toBe("left");
  });
});

describe("id generation", () => {
  it("uses short per-type prefixes", () => {
    expect(idPrefixForType("resistor")).toBe("r");
    expect(idPrefixForType("led")).toBe("led");
    expect(idPrefixForType("push-button")).toBe("btn");
    expect(idPrefixForType("some-new-type")).toBe("somenewtype");
  });

  it("continues after the largest number and skips used ids", () => {
    expect(nextId("r", new Set())).toBe("r1");
    expect(nextId("r", new Set(["r1", "r2", "r7", "led3"]))).toBe("r8");
    expect(nextId("led", new Set(["led1", "ledx"]))).toBe("led2");
  });

  it("treats board, component and connection ids as one namespace", () => {
    const circuit = normalizeCircuit(parseCircuitDocument(structuredClone(externalLed)));
    expect([...collectIds(circuit)].sort()).toEqual(["led1", "resistor1", "uno1", "w1", "w2", "w3"]);
  });
});
