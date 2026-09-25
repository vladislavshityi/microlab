import type { NormalizedCircuit } from "./circuit-document";

/** Короткие префиксы id по типу компонента: r1, led1, btn1. */
const ID_PREFIXES: Readonly<Record<string, string>> = {
  resistor: "r",
  led: "led",
  "push-button": "btn",
};

/** Префикс id соединений (проводов): w1, w2, … */
export const CONNECTION_ID_PREFIX = "w";

/** Префикс для типа; для типов без явного префикса — тип без дефисов. */
export function idPrefixForType(type: string): string {
  return ID_PREFIXES[type] ?? type.replace(/-/g, "");
}

/** Все id документа: плата, компоненты и соединения используют одно пространство имён. */
export function collectIds(
  circuit: Pick<NormalizedCircuit, "board" | "components" | "connections">,
): Set<string> {
  return new Set([circuit.board.id, ...Object.keys(circuit.components), ...Object.keys(circuit.connections)]);
}

/**
 * Следующий свободный id вида `<prefix><n>`: n на единицу больше максимального среди
 * существующих id с тем же префиксом, поэтому удалённые номера не переиспользуются,
 * пока есть объекты с большими номерами.
 */
export function nextId(prefix: string, existing: ReadonlySet<string>): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of existing) {
    const match = pattern.exec(id);
    if (match?.[1] !== undefined) {
      max = Math.max(max, Number(match[1]));
    }
  }
  let candidate = max + 1;
  while (existing.has(`${prefix}${candidate}`)) {
    candidate += 1;
  }
  return `${prefix}${candidate}`;
}
