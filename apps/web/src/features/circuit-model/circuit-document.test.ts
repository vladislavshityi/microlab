import { describe, expect, it } from "vitest";
import externalLed from "@microlab/circuit-schema/examples/external-led.json";

import { useCircuitStore } from "@/stores/circuit-store";

import {
  CircuitDocumentError,
  createEmptyCircuit,
  denormalizeCircuit,
  normalizeCircuit,
  parseCircuitDocument,
} from "./circuit-document";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectError(fn: () => unknown, code: CircuitDocumentError["code"]) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CircuitDocumentError);
    expect((error as CircuitDocumentError).code).toBe(code);
    return error as CircuitDocumentError;
  }
  throw new Error("expected CircuitDocumentError");
}

describe("circuit document", () => {
  it("round-trips the reference document without changes", () => {
    const document = parseCircuitDocument(clone(externalLed));
    expect(denormalizeCircuit(normalizeCircuit(document))).toEqual(externalLed);
  });

  it("normalizes components and connections by id, keeping order", () => {
    const circuit = normalizeCircuit(parseCircuitDocument(clone(externalLed)));
    expect(circuit.componentOrder).toEqual(["resistor1", "led1"]);
    expect(circuit.connectionOrder).toEqual(["w1", "w2", "w3"]);
    expect(circuit.components["led1"]?.type).toBe("led");
  });

  it.each([2, 0, "1", undefined])("rejects schemaVersion %j with a clear error", (version) => {
    const raw = { ...clone(externalLed), schemaVersion: version };
    const error = expectError(() => parseCircuitDocument(raw), "UNSUPPORTED_SCHEMA_VERSION");
    expect(error.message).toContain("supported: 1");
  });

  it("rejects malformed documents", () => {
    expectError(() => parseCircuitDocument([]), "INVALID_DOCUMENT");
    const raw = clone(externalLed);
    raw.components = raw.components.map((c, i) => (i === 0 ? { ...c, rotation: 45 } : c));
    expectError(() => parseCircuitDocument(raw), "INVALID_DOCUMENT");
  });

  it("rejects duplicate ids, including the board id", () => {
    const raw = clone(externalLed);
    raw.components = raw.components.map((c, i) => (i === 1 ? { ...c, id: "uno1" } : c));
    expectError(() => normalizeCircuit(parseCircuitDocument(raw)), "DUPLICATE_ID");
  });
});

describe("circuitStore", () => {
  it("starts with an empty UNO R3 circuit", () => {
    useCircuitStore.getState().reset();
    expect(useCircuitStore.getState().serialize()).toEqual(createEmptyCircuit());
  });

  it("deserializes and serializes documents; a failed load keeps the state", () => {
    const store = useCircuitStore.getState();
    store.deserialize(clone(externalLed));
    expect(useCircuitStore.getState().serialize()).toEqual(externalLed);

    expectError(() => {
      store.deserialize({ ...clone(externalLed), schemaVersion: 99 });
    }, "UNSUPPORTED_SCHEMA_VERSION");
    expect(useCircuitStore.getState().serialize()).toEqual(externalLed);
    store.reset();
  });
});
