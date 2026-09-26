import type { CircuitDocument, GridPoint, PinRef, PropertyValue } from "@microlab/circuit-schema";
import { create } from "zustand";

import * as commands from "@/features/circuit-model/circuit-commands";
import {
  createEmptyCircuit,
  denormalizeCircuit,
  normalizeCircuit,
  parseCircuitDocument,
  type NormalizedCircuit,
} from "@/features/circuit-model/circuit-document";
import type { ConnectionRejection } from "@/features/circuit-model/connection-rules";

/** Максимальное число шагов отмены. */
export const HISTORY_LIMIT = 200;

/** Выделение на схеме: id платы или компонентов и id соединений. */
export interface CircuitSelection {
  componentIds: readonly string[];
  connectionIds: readonly string[];
}

const EMPTY_SELECTION: CircuitSelection = { componentIds: [], connectionIds: [] };

interface CircuitState extends NormalizedCircuit {
  /** Снимки схемы до каждого изменения (для отмены) и после отмены (для повтора). */
  past: readonly NormalizedCircuit[];
  future: readonly NormalizedCircuit[];
  /** Снимок в начале жеста (перетаскивание): весь жест — один шаг отмены. */
  gestureBase: NormalizedCircuit | null;
  selection: CircuitSelection;
  /** Начатое соединение: вывод, от которого тянется провод. */
  pendingConnection: PinRef | null;

  /** Заменяет схему документом; при ошибке состояние не меняется. История очищается. */
  /** Схема только для просмотра: команды изменения игнорируются. */
  readOnly: boolean;
  setReadOnly: (readOnly: boolean) => void;
  loadDocument: (document: CircuitDocument) => void;
  /** Разбирает JSON-данные (с проверкой schemaVersion) и загружает схему. */
  deserialize: (raw: unknown) => void;
  /** Документ схемы в формате хранения (порядок объектов сохраняется). */
  serialize: () => CircuitDocument;
  reset: () => void;

  addComponent: (type: string, position: GridPoint) => string;
  deleteItems: (componentIds: readonly string[], connectionIds: readonly string[]) => void;
  deleteSelection: () => void;
  moveItems: (positions: Readonly<Record<string, GridPoint>>) => void;
  rotateItems: (ids: readonly string[]) => void;
  rotateSelection: () => void;
  duplicateSelection: () => void;
  setProperty: (componentId: string, propertyId: string, value: PropertyValue) => void;
  /** Создаёт соединение; возвращает причину отказа или null при успехе. */
  connect: (from: PinRef, to: PinRef) => ConnectionRejection | null;
  setConnectionColor: (id: string, color: string | undefined) => void;
  setConnectionRoute: (id: string, route: readonly GridPoint[] | undefined) => void;

  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;

  select: (selection: CircuitSelection) => void;
  setPendingConnection: (pin: PinRef | null) => void;
}

export function pickCircuit(state: NormalizedCircuit): NormalizedCircuit {
  return {
    board: state.board,
    components: state.components,
    componentOrder: state.componentOrder,
    connections: state.connections,
    connectionOrder: state.connectionOrder,
  };
}

function sameCircuit(a: NormalizedCircuit, b: NormalizedCircuit): boolean {
  return (
    a.board === b.board &&
    a.components === b.components &&
    a.componentOrder === b.componentOrder &&
    a.connections === b.connections &&
    a.connectionOrder === b.connectionOrder
  );
}

/** Оставляет в выделении только существующие объекты. */
function pruneSelection(selection: CircuitSelection, circuit: NormalizedCircuit): CircuitSelection {
  const componentIds = selection.componentIds.filter(
    (id) => id === circuit.board.id || id in circuit.components,
  );
  const connectionIds = selection.connectionIds.filter((id) => id in circuit.connections);
  return componentIds.length === selection.componentIds.length &&
    connectionIds.length === selection.connectionIds.length
    ? selection
    : { componentIds, connectionIds };
}

function initialState(circuit: NormalizedCircuit) {
  return {
    ...circuit,
    past: [],
    future: [],
    gestureBase: null,
    selection: EMPTY_SELECTION,
    pendingConnection: null,
  };
}

/**
 * Circuit Model на frontend — единственный источник истины для схемы; холст только
 * отображает его. Хранится в нормализованном виде: объекты по id и их порядок.
 *
 * Все изменения идут через команды (circuit-commands); перед каждым изменением
 * сохраняется снимок схемы. Снимки неизменяемы и разделяют неизменённые объекты,
 * поэтому история из сотен шагов дешева.
 */
export const useCircuitStore = create<CircuitState>()((set, get) => {
  /** Применяет команду; при активном жесте изменение не создаёт отдельного шага отмены. */
  const apply = (command: (circuit: NormalizedCircuit) => NormalizedCircuit) => {
    const state = get();
    if (state.readOnly) {
      return;
    }
    const current = pickCircuit(state);
    const next = command(current);
    if (sameCircuit(next, current)) {
      return;
    }
    const selection = pruneSelection(state.selection, next);
    if (state.gestureBase !== null) {
      set({ ...next, selection });
      return;
    }
    set({
      ...next,
      selection,
      past: [...state.past, current].slice(-HISTORY_LIMIT),
      future: [],
    });
  };

  const load = (circuit: NormalizedCircuit) => {
    set(initialState(circuit));
  };

  return {
    ...initialState(normalizeCircuit(createEmptyCircuit())),
    readOnly: false,
    setReadOnly: (readOnly) => {
      set({ readOnly, pendingConnection: null });
    },

    loadDocument: (document) => {
      load(normalizeCircuit(document));
    },
    deserialize: (raw) => {
      load(normalizeCircuit(parseCircuitDocument(raw)));
    },
    serialize: () => denormalizeCircuit(get()),
    reset: () => {
      load(normalizeCircuit(createEmptyCircuit()));
    },

    addComponent: (type, position) => {
      if (get().readOnly) return "";
      let id = "";
      apply((circuit) => {
        const result = commands.addComponent(circuit, type, position);
        id = result.id;
        return result.circuit;
      });
      set({ selection: { componentIds: [id], connectionIds: [] } });
      return id;
    },
    deleteItems: (componentIds, connectionIds) => {
      apply((circuit) => commands.removeItems(circuit, componentIds, connectionIds));
    },
    deleteSelection: () => {
      const { selection } = get();
      get().deleteItems(selection.componentIds, selection.connectionIds);
    },
    moveItems: (positions) => {
      apply((circuit) => commands.moveItems(circuit, positions));
    },
    rotateItems: (ids) => {
      apply((circuit) => commands.rotateItems(circuit, ids));
    },
    rotateSelection: () => {
      get().rotateItems(get().selection.componentIds);
    },
    duplicateSelection: () => {
      const ids = get().selection.componentIds;
      let copies: string[] = [];
      apply((circuit) => {
        const result = commands.duplicateComponents(circuit, ids);
        copies = result.ids;
        return result.circuit;
      });
      if (copies.length > 0) {
        set({ selection: { componentIds: copies, connectionIds: [] } });
      }
    },
    setProperty: (componentId, propertyId, value) => {
      apply((circuit) => commands.setProperty(circuit, componentId, propertyId, value));
    },
    connect: (from, to) => {
      if (get().readOnly) return null;
      try {
        let id = "";
        apply((circuit) => {
          const result = commands.addConnection(circuit, from, to);
          id = result.id;
          return result.circuit;
        });
        set({ pendingConnection: null, selection: { componentIds: [], connectionIds: [id] } });
        return null;
      } catch (error) {
        if (error instanceof commands.CircuitCommandError) {
          const { code } = error;
          if (code === "SAME_PIN" || code === "DUPLICATE" || code === "UNKNOWN_PIN") {
            set({ pendingConnection: null });
            return code;
          }
        }
        throw error;
      }
    },
    setConnectionColor: (id, color) => {
      apply((circuit) => commands.setConnectionColor(circuit, id, color));
    },
    setConnectionRoute: (id, route) => {
      apply((circuit) => commands.setConnectionRoute(circuit, id, route));
    },

    beginGesture: () => {
      const state = get();
      if (state.gestureBase === null) {
        set({ gestureBase: pickCircuit(state) });
      }
    },
    endGesture: () => {
      const state = get();
      const base = state.gestureBase;
      if (base === null) {
        return;
      }
      const current = pickCircuit(state);
      if (sameCircuit(base, current)) {
        set({ gestureBase: null });
        return;
      }
      set({
        gestureBase: null,
        past: [...state.past, base].slice(-HISTORY_LIMIT),
        future: [],
      });
    },
    undo: () => {
      get().endGesture();
      const state = get();
      const previous = state.past.at(-1);
      if (previous === undefined) {
        return;
      }
      set({
        ...previous,
        past: state.past.slice(0, -1),
        future: [pickCircuit(state), ...state.future].slice(0, HISTORY_LIMIT),
        selection: pruneSelection(state.selection, previous),
        pendingConnection: null,
      });
    },
    redo: () => {
      get().endGesture();
      const state = get();
      const next = state.future[0];
      if (next === undefined) {
        return;
      }
      set({
        ...next,
        past: [...state.past, pickCircuit(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selection: pruneSelection(state.selection, next),
        pendingConnection: null,
      });
    },

    select: (selection) => {
      set({ selection: pruneSelection(selection, pickCircuit(get())) });
    },
    setPendingConnection: (pin) => {
      set({ pendingConnection: pin });
    },
  };
});

/** Можно ли отменить или повторить (для кнопок панели). */
export const selectCanUndo = (state: CircuitState) => state.past.length > 0;
export const selectCanRedo = (state: CircuitState) => state.future.length > 0;
