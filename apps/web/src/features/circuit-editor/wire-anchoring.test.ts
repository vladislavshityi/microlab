import { COMPONENT_DEFINITIONS, type GridPoint, type Rotation } from "@microlab/circuit-schema";
import { describe, expect, it } from "vitest";

import { GRID_PX, instanceBox, pinGridPosition, resolvePin, ROTATIONS } from "@/features/circuit-model/geometry";
import { connectionPolyline } from "@/features/circuit-model/wire-geometry";
import { pickCircuit, useCircuitStore } from "@/stores/circuit-store";

import { createNodeBuilder, PIN_HIT_PX, pinLayouts } from "./flow-model";
import { rotationTransform } from "./rotation";

const store = () => useCircuitStore.getState();

/** Применяет строку SVG-преобразования вида «translate(a b) rotate(r)» к точке. */
function applyTransform(transform: string | undefined, point: GridPoint): GridPoint {
  if (transform === undefined) return point;
  const match = /translate\(([-\d.]+) ([-\d.]+)\) rotate\((\d+)\)/.exec(transform);
  if (match === null) throw new Error(`Unexpected transform ${transform}`);
  const [, tx, ty, angle] = match;
  const radians = (Number(angle) * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians));
  const sin = Math.round(Math.sin(radians));
  return {
    x: cos * point.x - sin * point.y + Number(tx),
    y: sin * point.x + cos * point.y + Number(ty),
  };
}

const OPPOSITE = { left: "right", right: "left", up: "down", down: "up" } as const;

function direction(a: GridPoint, b: GridPoint): keyof typeof OPPOSITE {
  if (a.x === b.x) return b.y > a.y ? "down" : "up";
  return b.x > a.x ? "right" : "left";
}

/** Все провода схемы: концы на выводах, ортогональность, выход из выводов наружу. */
function expectWiresAnchored() {
  const state = store();
  const circuit = pickCircuit(state);
  const nodes = createNodeBuilder()(circuit, { componentIds: [], connectionIds: [] });
  for (const id of state.connectionOrder) {
    const connection = state.connections[id];
    if (connection === undefined) throw new Error(id);
    const source = (componentId: string) =>
      componentId === state.board.id ? state.board : state.components[componentId];
    const fromSource = source(connection.from.componentId);
    const toSource = source(connection.to.componentId);
    if (fromSource === undefined || toSource === undefined) throw new Error(id);
    const points = connectionPolyline(connection, fromSource, toSource);
    if (points === null) throw new Error(`no polyline for ${id}`);
    const from = resolvePin(circuit, connection.from.componentId, connection.from.pinId);
    const to = resolvePin(circuit, connection.to.componentId, connection.to.pinId);
    expect(points[0], `${id} start`).toEqual(from?.point);
    expect(points.at(-1), `${id} end`).toEqual(to?.point);

    // Конец провода совпадает с центром отрисованного вывода (узел + handle).
    for (const [end, ref] of [
      [points[0], connection.from],
      [points.at(-1), connection.to],
    ] as const) {
      const node = nodes.find((candidate) => candidate.id === ref.componentId);
      const handle = node?.handles?.find((candidate) => candidate.id === ref.pinId);
      expect(node && handle && end, `${id} handle`).toBeTruthy();
      if (node === undefined || handle === undefined || end === undefined) continue;
      expect({
        x: node.position.x + handle.x + PIN_HIT_PX / 2,
        y: node.position.y + handle.y + PIN_HIT_PX / 2,
      }).toEqual({ x: end.x * GRID_PX, y: end.y * GRID_PX });
    }

    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      expect(a !== undefined && b !== undefined && (a.x === b.x || a.y === b.y), `${id} orthogonal`).toBe(true);
    }
    const [p0, p1] = points;
    const q1 = points.at(-2);
    const q0 = points.at(-1);
    if (from?.direction && p0 && p1) expect(direction(p0, p1), `${id} leaves outward`).toBe(from.direction);
    if (to?.direction && q1 && q0) expect(direction(q1, q0), `${id} enters from outside`).toBe(OPPOSITE[to.direction]);

    // Автоматическая трасса не проходит через корпуса компонентов на концах.
    if (connection.route === undefined) {
      for (const box of [instanceBox(fromSource), instanceBox(toSource)]) {
        if (box === undefined) continue;
        for (let i = 0; i + 1 < points.length; i += 1) {
          const a = points[i];
          const b = points[i + 1];
          if (a === undefined || b === undefined) continue;
          const crosses =
            a.y === b.y
              ? a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width
              : a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height;
          expect(crosses, `${id} crosses ${JSON.stringify(box)}`).toBe(false);
        }
      }
    }
  }
}

describe("pin geometry after rotation", () => {
  it.each(COMPONENT_DEFINITIONS.flatMap((definition) => ROTATIONS.map((rotation) => [definition.type, rotation] as const)))(
    "%s at %i°: handle, symbol and model agree",
    (type, rotation: Rotation) => {
      const definition = COMPONENT_DEFINITIONS.find((candidate) => candidate.type === type);
      if (definition === undefined) throw new Error(type);
      const instance = { id: "x1", type, position: { x: 7, y: 3 }, rotation };
      const layouts = pinLayouts(definition, rotation);
      const transform = rotationTransform(rotation, definition.visual.width, definition.visual.height);
      for (const layout of layouts) {
        const model = pinGridPosition(instance, definition, layout.id);
        const local = definition.visual.pins[layout.id];
        if (model === undefined || local === undefined) throw new Error(layout.id);
        // Handle узла (px) — там же, где вывод модели.
        expect({ x: 7 * GRID_PX + layout.x, y: 3 * GRID_PX + layout.y }).toEqual({
          x: model.x * GRID_PX,
          y: model.y * GRID_PX,
        });
        // Нарисованный вывод символа (SVG-поворот) — там же.
        const drawn = applyTransform(transform, local);
        expect({ x: drawn.x + 7, y: drawn.y + 3 }).toEqual(model);
      }
    },
  );
});

describe("wires stay anchored and orthogonal", () => {
  function build() {
    store().addComponent("resistor", { x: 18, y: 5 });
    store().addComponent("led", { x: 26, y: 9 });
    expect(store().addComponent("breadboard", { x: 16, y: 20 })).toBe("bb1");
    expect(store().connect({ componentId: "uno1", pinId: "D13" }, { componentId: "r1", pinId: "1" })).toBeNull();
    expect(store().connect({ componentId: "r1", pinId: "2" }, { componentId: "led1", pinId: "A" })).toBeNull();
    expect(store().connect({ componentId: "led1", pinId: "K" }, { componentId: "uno1", pinId: "GND3" })).toBeNull();
    const hole = COMPONENT_DEFINITIONS.find((definition) => definition.type === "breadboard")?.pins[40]?.id;
    if (hole === undefined) throw new Error("breadboard hole");
    expect(store().connect({ componentId: "uno1", pinId: "5V" }, { componentId: "bb1", pinId: hole })).toBeNull();
    // Провод, трассу которого пользователь уже редактировал.
    store().setConnectionRoute("w3", [
      { x: 32, y: 10 },
      { x: 32, y: 3 },
      { x: 14, y: 3 },
    ]);
  }

  it("after rotating either endpoint to every angle", () => {
    build();
    expectWiresAnchored();
    for (const id of ["r1", "led1"]) {
      for (let i = 0; i < 4; i += 1) {
        store().rotateItems([id]);
        expectWiresAnchored();
      }
    }
    for (const id of ["uno1", "bb1"]) {
      for (let i = 0; i < 4; i += 1) {
        store().rotateItems([id]);
        expectWiresAnchored();
      }
    }
  });

  it("after moving endpoints to every side of each other", () => {
    build();
    for (const position of [
      { x: 40, y: 5 },
      { x: -10, y: 5 },
      { x: 5, y: -8 },
      { x: 5, y: 30 },
      { x: 13, y: 6 },
    ]) {
      store().moveItems({ r1: position, led1: { x: position.x + 3, y: position.y + 4 } });
      expectWiresAnchored();
      store().rotateItems(["led1"]);
      expectWiresAnchored();
    }
  });

  it("after duplicate, undo/redo and reload", () => {
    build();
    store().rotateItems(["r1"]);
    store().select({ componentIds: ["r1", "led1"], connectionIds: [] });
    store().duplicateSelection();
    expectWiresAnchored();
    store().undo();
    store().undo();
    expectWiresAnchored();
    store().redo();
    store().redo();
    expectWiresAnchored();
    const document = JSON.parse(JSON.stringify(store().serialize())) as unknown;
    store().reset();
    store().deserialize(document);
    expectWiresAnchored();
  });
});
