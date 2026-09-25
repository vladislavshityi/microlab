import externalLed from "@microlab/circuit-schema/examples/external-led.json";
import { describe, expect, it } from "vitest";

import { CircuitCommandError } from "@/features/circuit-model/circuit-commands";
import { checkNewConnection } from "@/features/circuit-model/connection-rules";

import { HISTORY_LIMIT, pickCircuit, useCircuitStore } from "./circuit-store";

const store = () => useCircuitStore.getState();

describe("circuitStore commands", () => {
  it("adds components with per-type ids and explicit default properties", () => {
    expect(store().addComponent("resistor", { x: 20, y: 4 })).toBe("r1");
    expect(store().addComponent("resistor", { x: 20, y: 8 })).toBe("r2");
    expect(store().addComponent("led", { x: 26, y: 4 })).toBe("led1");
    expect(store().addComponent("push-button", { x: 26, y: 8 })).toBe("btn1");
    expect(store().components["r1"]).toEqual({
      id: "r1",
      type: "resistor",
      position: { x: 20, y: 4 },
      rotation: 0,
      properties: { resistanceOhms: 220, tolerancePercent: 5 },
    });
    expect(store().selection.componentIds).toEqual(["btn1"]);
  });

  it("rejects unknown types and a second board", () => {
    expect(() => store().addComponent("flux-capacitor", { x: 0, y: 0 })).toThrow(CircuitCommandError);
    expect(() => store().addComponent("arduino-uno-r3", { x: 0, y: 0 })).toThrow(CircuitCommandError);
    expect(store().past).toHaveLength(0);
  });

  it("deletes components together with their connections; the board is never deleted", () => {
    const r1 = store().addComponent("resistor", { x: 20, y: 4 });
    const led1 = store().addComponent("led", { x: 26, y: 4 });
    expect(store().connect({ componentId: "uno1", pinId: "D13" }, { componentId: r1, pinId: "1" })).toBeNull();
    expect(store().connect({ componentId: r1, pinId: "2" }, { componentId: led1, pinId: "A" })).toBeNull();
    expect(store().connect({ componentId: led1, pinId: "K" }, { componentId: "uno1", pinId: "GND1" })).toBeNull();
    expect(store().connectionOrder).toEqual(["w1", "w2", "w3"]);

    store().select({ componentIds: ["uno1", r1], connectionIds: [] });
    store().deleteSelection();
    expect(store().board.id).toBe("uno1");
    expect(store().componentOrder).toEqual([led1]);
    expect(store().connectionOrder).toEqual(["w3"]);
    expect(store().selection.componentIds).toEqual(["uno1"]);

    // Отмена возвращает компонент и его соединения одним шагом.
    store().undo();
    expect(store().componentOrder).toEqual([r1, led1]);
    expect(store().connectionOrder).toEqual(["w1", "w2", "w3"]);
  });

  it("rejects self and duplicate connections in either direction", () => {
    const r1 = store().addComponent("resistor", { x: 20, y: 4 });
    const a = { componentId: r1, pinId: "1" };
    const b = { componentId: "uno1", pinId: "D2" };
    expect(store().connect(a, a)).toBe("SAME_PIN");
    expect(store().connect(a, b)).toBeNull();
    expect(store().connect(a, b)).toBe("DUPLICATE");
    expect(store().connect(b, a)).toBe("DUPLICATE");
    expect(store().connect(a, { componentId: r1, pinId: "9" })).toBe("UNKNOWN_PIN");
    // Два вывода одного компонента соединить можно: это не доказуемо невозможная схема.
    expect(store().connect(a, { componentId: r1, pinId: "2" })).toBeNull();
    expect(store().connectionOrder).toHaveLength(2);
    expect(checkNewConnection(pickCircuit(store()), a, { componentId: "ghost", pinId: "1" })).toBe("UNKNOWN_PIN");
  });

  it("rotates clockwise keeping the symbol centre", () => {
    const r1 = store().addComponent("resistor", { x: 10, y: 10 });
    store().rotateItems([r1]);
    expect(store().components[r1]).toMatchObject({ rotation: 90, position: { x: 11, y: 9 } });
    store().rotateItems([r1]);
    store().rotateItems([r1]);
    store().rotateItems([r1]);
    expect(store().components[r1]).toMatchObject({ rotation: 0, position: { x: 10, y: 10 } });
  });

  it("validates property values against the definition", () => {
    const r1 = store().addComponent("resistor", { x: 0, y: 0 });
    store().setProperty(r1, "resistanceOhms", 4700);
    expect(store().components[r1]?.properties["resistanceOhms"]).toBe(4700);
    expect(() => {
      store().setProperty(r1, "resistanceOhms", 0);
    }).toThrow(CircuitCommandError);
    expect(() => {
      store().setProperty(r1, "resistanceOhms", "220");
    }).toThrow(CircuitCommandError);
    expect(() => {
      store().setProperty(r1, "unknown", 1);
    }).toThrow(CircuitCommandError);
    const led1 = store().addComponent("led", { x: 0, y: 4 });
    store().setProperty(led1, "color", "green");
    expect(() => {
      store().setProperty(led1, "color", "infrared");
    }).toThrow(CircuitCommandError);
  });

  it("duplicates components with their internal connections", () => {
    const r1 = store().addComponent("resistor", { x: 20, y: 4 });
    const led1 = store().addComponent("led", { x: 26, y: 4 });
    store().setProperty(r1, "resistanceOhms", 1000);
    store().connect({ componentId: r1, pinId: "2" }, { componentId: led1, pinId: "A" });
    store().connect({ componentId: "uno1", pinId: "D13" }, { componentId: r1, pinId: "1" });
    store().select({ componentIds: [r1, led1, "uno1"], connectionIds: [] });
    store().duplicateSelection();
    expect(store().componentOrder).toEqual([r1, led1, "r2", "led2"]);
    expect(store().components["r2"]).toMatchObject({ position: { x: 22, y: 6 }, properties: { resistanceOhms: 1000 } });
    expect(store().connections["w3"]).toMatchObject({
      from: { componentId: "r2", pinId: "2" },
      to: { componentId: "led2", pinId: "A" },
    });
    expect(store().connectionOrder).toHaveLength(3);
    expect(store().selection.componentIds).toEqual(["r2", "led2"]);
  });

  it("stores wire colour and route only as visual metadata", () => {
    store().connect({ componentId: "uno1", pinId: "D13" }, { componentId: "uno1", pinId: "GND3" });
    store().setConnectionColor("w1", "#dc2626");
    store().setConnectionRoute("w1", [{ x: 14, y: 6 }]);
    expect(store().connections["w1"]).toMatchObject({ color: "#dc2626", route: [{ x: 14, y: 6 }] });
    store().setConnectionColor("w1", undefined);
    store().setConnectionRoute("w1", []);
    expect(store().connections["w1"]).toEqual({
      id: "w1",
      from: { componentId: "uno1", pinId: "D13" },
      to: { componentId: "uno1", pinId: "GND3" },
    });
  });
});

describe("circuitStore undo/redo", () => {
  it("undoes and redoes each command on domain state", () => {
    const r1 = store().addComponent("resistor", { x: 0, y: 0 });
    store().moveItems({ [r1]: { x: 5, y: 5 } });
    store().rotateItems([r1]);
    store().setProperty(r1, "resistanceOhms", 330);
    store().connect({ componentId: r1, pinId: "1" }, { componentId: "uno1", pinId: "5V" });
    store().setConnectionColor("w1", "#2563eb");
    expect(store().past).toHaveLength(6);

    store().undo();
    expect(store().connections["w1"]?.color).toBeUndefined();
    store().undo();
    expect(store().connectionOrder).toEqual([]);
    store().undo();
    expect(store().components[r1]?.properties["resistanceOhms"]).toBe(220);
    store().undo();
    expect(store().components[r1]?.rotation).toBe(0);
    store().undo();
    expect(store().components[r1]?.position).toEqual({ x: 0, y: 0 });
    store().undo();
    expect(store().componentOrder).toEqual([]);
    store().undo();
    expect(store().past).toHaveLength(0);

    for (let i = 0; i < 6; i += 1) store().redo();
    expect(store().connections["w1"]?.color).toBe("#2563eb");
    expect(store().components[r1]).toMatchObject({ position: { x: 6, y: 4 }, rotation: 90 });
    expect(store().future).toHaveLength(0);
  });

  it("clears redo after a new change and ignores no-op commands", () => {
    const r1 = store().addComponent("resistor", { x: 0, y: 0 });
    store().moveItems({ [r1]: { x: 0, y: 0 } });
    store().setProperty(r1, "resistanceOhms", 220);
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(store().future).toHaveLength(1);
    store().addComponent("led", { x: 0, y: 0 });
    expect(store().future).toHaveLength(0);
  });

  it("groups a drag gesture into one undo step", () => {
    const r1 = store().addComponent("resistor", { x: 0, y: 0 });
    store().beginGesture();
    for (let x = 1; x <= 20; x += 1) {
      store().moveItems({ [r1]: { x, y: 0 } });
    }
    store().endGesture();
    expect(store().past).toHaveLength(2);
    store().undo();
    expect(store().components[r1]?.position).toEqual({ x: 0, y: 0 });

    // Жест без изменений не создаёт шага.
    store().beginGesture();
    store().endGesture();
    expect(store().past).toHaveLength(1);
  });

  it("keeps at most HISTORY_LIMIT steps", () => {
    const r1 = store().addComponent("resistor", { x: 0, y: 0 });
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) {
      store().moveItems({ [r1]: { x: i, y: 0 } });
    }
    expect(store().past).toHaveLength(HISTORY_LIMIT);
  });

  it("loading a document resets history and selection", () => {
    store().addComponent("resistor", { x: 0, y: 0 });
    store().loadDocument(structuredClone(externalLed) as Parameters<ReturnType<typeof store>["loadDocument"]>[0]);
    expect(store().past).toHaveLength(0);
    expect(store().selection.componentIds).toEqual([]);
  });
});

describe("circuitStore serialization", () => {
  it("round-trips the document after edits", () => {
    const r1 = store().addComponent("resistor", { x: 20, y: 8 });
    const led1 = store().addComponent("led", { x: 28, y: 8 });
    store().rotateItems([led1]);
    store().setProperty(r1, "resistanceOhms", 4700);
    store().connect({ componentId: "uno1", pinId: "D13" }, { componentId: r1, pinId: "1" });
    store().setConnectionColor("w1", "#d97706");
    store().setConnectionRoute("w1", [
      { x: 16, y: 6 },
      { x: 16, y: 9 },
    ]);
    store().moveItems({ uno1: { x: -2, y: 1 } });

    const document = store().serialize();
    expect(document.schemaVersion).toBe(1);
    expect(document.board).toEqual({ id: "uno1", type: "arduino-uno-r3", position: { x: -2, y: 1 }, rotation: 0 });
    const json = JSON.parse(JSON.stringify(document)) as unknown;

    store().reset();
    expect(store().componentOrder).toEqual([]);
    store().deserialize(json);
    expect(store().serialize()).toEqual(document);
  });
});
