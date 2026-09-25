import breadboardLed from "@microlab/circuit-schema/examples/breadboard-led.json";
import externalLed from "@microlab/circuit-schema/examples/external-led.json";
import breadboardLedNets from "@microlab/circuit-schema/examples/netlists/breadboard-led.json";
import externalLedNets from "@microlab/circuit-schema/examples/netlists/external-led.json";
import { describe, expect, it } from "vitest";

import { normalizeCircuit, parseCircuitDocument } from "./circuit-document";
import { buildNetlist, getNetlist } from "./netlist";

function netlistOf(raw: unknown) {
  return buildNetlist(normalizeCircuit(parseCircuitDocument(structuredClone(raw))));
}

describe("buildNetlist", () => {
  // Те же эталоны проверяет backend: netlist одинаков в обоих языках.
  it.each([
    ["external-led", externalLed, externalLedNets],
    ["breadboard-led", breadboardLed, breadboardLedNets],
  ])("matches the shared golden netlist: %s", (_name, example, expected) => {
    expect(netlistOf(example).nets).toEqual(expected);
  });

  it("connects a pin to a hole only on exact grid coincidence", () => {
    const raw = structuredClone(breadboardLed);
    const resistor = raw.components.find((component) => component.id === "r1");
    if (resistor === undefined) throw new Error("r1 missing");
    // Сдвиг на один узел вниз: вывод 1 уходит из строки c в строку d того же столбца.
    resistor.position = { x: resistor.position.x, y: resistor.position.y + 1 };
    expect(netlistOf(raw).netByPin.get("r1.1")?.members).toContain("uno1.D13");
    // Между строками e и f отверстий нет: вывод в канавке ни с чем не соединён.
    resistor.position = { x: resistor.position.x, y: 8 };
    expect(netlistOf(raw).netByPin.get("r1.1")).toBeUndefined();
  });

  it("does not report strips with nothing plugged in", () => {
    const nets = netlistOf(breadboardLed).nets;
    expect(nets.every((net) => !net.members.every((member) => member.startsWith("bb1.")))).toBe(true);
  });

  it("caches by state references", () => {
    const circuit = normalizeCircuit(parseCircuitDocument(structuredClone(externalLed)));
    expect(getNetlist(circuit)).toBe(getNetlist({ ...circuit }));
    expect(getNetlist(circuit)).not.toBe(getNetlist({ ...circuit, connections: { ...circuit.connections } }));
  });
});

describe("buildNetlist on a large circuit", () => {
  it("handles a breadboard with 100 components and 300 wires", async () => {
    const { createStressCircuit } = await import("./stress-circuit");
    const circuit = normalizeCircuit(createStressCircuit(100, 300, 1, true));
    const started = performance.now();
    const { nets } = buildNetlist(circuit);
    // Порог щедрый: проверяется порядок величины, а не точное время.
    expect(performance.now() - started).toBeLessThan(200);
    expect(nets.some((net) => net.members.some((member) => member.startsWith("bb1.")))).toBe(true);
  });
});
