import { describe, expect, it } from "vitest";

import { normalizeCircuit } from "@/features/circuit-model/circuit-document";
import { resolvePin } from "@/features/circuit-model/geometry";
import { wirePolyline } from "@/features/circuit-model/routing";
import { createStressCircuit } from "@/features/circuit-model/stress-circuit";
import { pickCircuit, useCircuitStore } from "@/stores/circuit-store";

import { createEdgeBuilder, createNodeBuilder } from "./flow-model";

const NO_SELECTION = { componentIds: [], connectionIds: [] };

describe("flow model", () => {
  it("derives nodes with pin handles from the circuit model", () => {
    useCircuitStore.getState().addComponent("resistor", { x: 20, y: 4 });
    useCircuitStore.getState().rotateItems(["r1"]);
    const nodes = createNodeBuilder()(pickCircuit(useCircuitStore.getState()), {
      componentIds: ["r1"],
      connectionIds: [],
    });
    expect(nodes.map((node) => node.id)).toEqual(["uno1", "r1"]);
    const resistor = nodes[1];
    expect(resistor).toMatchObject({
      position: { x: 21 * 20, y: 3 * 20 },
      width: 40,
      height: 80,
      selected: true,
      deletable: true,
      ariaLabel: "Резистор r1, 220 Ω",
    });
    expect(resistor?.handles?.map((handle) => [handle.id, handle.x + 6, handle.y + 6])).toEqual([
      ["1", 20, 0],
      ["2", 20, 80],
    ]);
    expect(nodes[0]?.deletable).toBe(false);
  });

  it("keeps a 100-component / 300-connection circuit cheap to update", () => {
    const document = createStressCircuit(100, 300);
    expect(document.components).toHaveLength(100);
    expect(document.connections).toHaveLength(300);
    useCircuitStore.getState().loadDocument(document);
    const buildNodes = createNodeBuilder();
    const buildEdges = createEdgeBuilder();

    const started = performance.now();
    let nodes = buildNodes(pickCircuit(useCircuitStore.getState()), NO_SELECTION);
    let edges = buildEdges(pickCircuit(useCircuitStore.getState()), NO_SELECTION);
    // 60 кадров перетаскивания одного компонента одним жестом.
    useCircuitStore.getState().beginGesture();
    for (let frame = 1; frame <= 60; frame += 1) {
      useCircuitStore.getState().moveItems({ c1: { x: 20 + frame, y: 0 } });
      const state = pickCircuit(useCircuitStore.getState());
      const nextNodes = buildNodes(state, NO_SELECTION);
      const nextEdges = buildEdges(state, NO_SELECTION);
      // Перерисовывается только перемещённый узел; рёбра не пересоздаются.
      const changed = nextNodes.filter((node, index) => node !== nodes[index]).map((node) => node.id);
      expect(changed).toEqual(["c1"]);
      expect(nextEdges.every((edge, index) => edge === edges[index])).toBe(true);
      // Трассы проводов вычисляются из модели для каждого кадра.
      for (const connection of Object.values(state.connections)) {
        const from = resolvePin(state, connection.from.componentId, connection.from.pinId);
        const to = resolvePin(state, connection.to.componentId, connection.to.pinId);
        if (from !== undefined && to !== undefined) {
          wirePolyline(from.point, from.direction, to.point, to.direction, connection.route);
        }
      }
      nodes = nextNodes;
      edges = nextEdges;
    }
    useCircuitStore.getState().endGesture();
    const elapsed = performance.now() - started;
    expect(useCircuitStore.getState().past).toHaveLength(1);
    // Щедрый бюджет для CI: 60 кадров с пересчётом всех 300 трасс.
    expect(elapsed).toBeLessThan(1500);
  });

  it("stress circuit is a valid, deterministic document", () => {
    const a = createStressCircuit(30, 60, 7);
    expect(createStressCircuit(30, 60, 7)).toEqual(a);
    expect(() => normalizeCircuit(a)).not.toThrow();
  });
});
