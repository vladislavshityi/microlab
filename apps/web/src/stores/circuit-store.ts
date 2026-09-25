import type { CircuitDocument } from "@microlab/circuit-schema";
import { create } from "zustand";

import {
  createEmptyCircuit,
  denormalizeCircuit,
  normalizeCircuit,
  parseCircuitDocument,
  type NormalizedCircuit,
} from "@/features/circuit-model/circuit-document";

interface CircuitState extends NormalizedCircuit {
  /** Заменяет схему документом; при ошибке состояние не меняется. */
  loadDocument: (document: CircuitDocument) => void;
  /** Разбирает JSON-данные (с проверкой schemaVersion) и загружает схему. */
  deserialize: (raw: unknown) => void;
  /** Документ схемы в формате хранения (порядок объектов сохраняется). */
  serialize: () => CircuitDocument;
  reset: () => void;
}

/**
 * Circuit Model на frontend — единственный источник истины для схемы; холст только
 * отображает его. Хранится в нормализованном виде: объекты по id и их порядок.
 */
export const useCircuitStore = create<CircuitState>()((set, get) => ({
  ...normalizeCircuit(createEmptyCircuit()),
  loadDocument: (document) => {
    set(normalizeCircuit(document));
  },
  deserialize: (raw) => {
    set(normalizeCircuit(parseCircuitDocument(raw)));
  },
  serialize: () => denormalizeCircuit(get()),
  reset: () => {
    set(normalizeCircuit(createEmptyCircuit()));
  },
}));
