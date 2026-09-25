import {
  CIRCUIT_SCHEMA_VERSION,
  type BoardInstance,
  type CircuitDocument,
  type ComponentInstance,
  type Connection,
} from "@microlab/circuit-schema";

/** Стабильные коды ошибок разбора документа схемы (для сообщений UI через i18n). */
export type CircuitDocumentErrorCode =
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "DUPLICATE_ID";

export class CircuitDocumentError extends Error {
  readonly code: CircuitDocumentErrorCode;

  constructor(code: CircuitDocumentErrorCode, message: string) {
    super(message);
    this.name = "CircuitDocumentError";
    this.code = code;
  }
}

/** Нормализованное представление документа схемы: объекты по id плюс порядок. */
export interface NormalizedCircuit {
  board: BoardInstance;
  components: Readonly<Record<string, ComponentInstance>>;
  componentOrder: readonly string[];
  connections: Readonly<Record<string, Connection>>;
  connectionOrder: readonly string[];
}

/** Документ новой схемы: только плата Arduino UNO R3 (единственная плата MVP). */
export function createEmptyCircuit(): CircuitDocument {
  return {
    schemaVersion: CIRCUIT_SCHEMA_VERSION,
    board: { id: "uno1", type: "arduino-uno-r3" },
    components: [],
    connections: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGridPoint(value: unknown): boolean {
  return isRecord(value) && Number.isInteger(value["x"]) && Number.isInteger(value["y"]);
}

function isPinRef(value: unknown): boolean {
  return (
    isRecord(value) && typeof value["componentId"] === "string" && typeof value["pinId"] === "string"
  );
}

function invalid(message: string): CircuitDocumentError {
  return new CircuitDocumentError("INVALID_DOCUMENT", message);
}

/**
 * Разбирает документ схемы из JSON-данных.
 *
 * Проверяет версию формата (неизвестная версия отклоняется, а не «угадывается») и
 * структуру, необходимую для нормализации. Полную проверку по JSON Schema и ссылки на
 * определения компонентов выполняет backend.
 */
export function parseCircuitDocument(raw: unknown): CircuitDocument {
  if (!isRecord(raw)) {
    throw invalid("Circuit document must be a JSON object.");
  }
  const version = raw["schemaVersion"];
  if (version !== CIRCUIT_SCHEMA_VERSION) {
    throw new CircuitDocumentError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `Unsupported circuit schemaVersion ${version === undefined ? "undefined" : JSON.stringify(version)}; supported: ${CIRCUIT_SCHEMA_VERSION}.`,
    );
  }
  const { board, components, connections } = raw;
  if (!isRecord(board) || typeof board["id"] !== "string" || typeof board["type"] !== "string") {
    throw invalid("board must have string id and type.");
  }
  if (!Array.isArray(components) || !Array.isArray(connections)) {
    throw invalid("components and connections must be arrays.");
  }
  components.forEach((component: unknown, index) => {
    if (
      !isRecord(component) ||
      typeof component["id"] !== "string" ||
      typeof component["type"] !== "string" ||
      !isGridPoint(component["position"]) ||
      ![0, 90, 180, 270].includes(component["rotation"] as number) ||
      !isRecord(component["properties"])
    ) {
      throw invalid(`components[${index}] is malformed.`);
    }
  });
  connections.forEach((connection: unknown, index) => {
    if (
      !isRecord(connection) ||
      typeof connection["id"] !== "string" ||
      !isPinRef(connection["from"]) ||
      !isPinRef(connection["to"])
    ) {
      throw invalid(`connections[${index}] is malformed.`);
    }
  });
  // Структура проверена выше; остальные ограничения схемы проверяет backend.
  return raw as unknown as CircuitDocument;
}

function indexById<T extends { id: string }>(items: readonly T[], kind: string) {
  const byId: Record<string, T> = {};
  const order: string[] = [];
  for (const item of items) {
    if (Object.hasOwn(byId, item.id)) {
      throw new CircuitDocumentError("DUPLICATE_ID", `Duplicate ${kind} id ${JSON.stringify(item.id)}.`);
    }
    byId[item.id] = item;
    order.push(item.id);
  }
  return { byId, order };
}

export function normalizeCircuit(document: CircuitDocument): NormalizedCircuit {
  const components = indexById(document.components, "component");
  if (Object.hasOwn(components.byId, document.board.id)) {
    throw new CircuitDocumentError(
      "DUPLICATE_ID",
      `Duplicate component id ${JSON.stringify(document.board.id)}.`,
    );
  }
  const connections = indexById(document.connections, "connection");
  return {
    board: document.board,
    components: components.byId,
    componentOrder: components.order,
    connections: connections.byId,
    connectionOrder: connections.order,
  };
}

function pick<T>(byId: Readonly<Record<string, T>>, order: readonly string[]): T[] {
  return order.map((id) => {
    const item = byId[id];
    if (item === undefined) {
      throw new Error(`Circuit state is inconsistent: missing ${id}.`);
    }
    return item;
  });
}

export function denormalizeCircuit(circuit: NormalizedCircuit): CircuitDocument {
  return {
    schemaVersion: CIRCUIT_SCHEMA_VERSION,
    board: circuit.board,
    components: pick(circuit.components, circuit.componentOrder),
    connections: pick(circuit.connections, circuit.connectionOrder),
  };
}
