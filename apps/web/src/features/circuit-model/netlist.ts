import { getComponentDefinition, type ComponentDefinition } from "@microlab/circuit-schema";

import type { NormalizedCircuit } from "./circuit-document";
import { pinGridPosition, toPlacedInstance, type PlacedInstance } from "./geometry";

/**
 * Netlist схемы: объединение выводов в электрические узлы. Правила и порядок совпадают
 * с backend (общие эталонные примеры в circuit-schema проверяют это в обоих языках):
 *
 * - узлы образуют провода, внутренние соединения определений и совпадение по сетке:
 *   вывод компонента, лежащий точно в точке вывода компонента-гнезда (`socket`,
 *   например отверстие макетной платы), соединён с ним; выводы платы и других гнёзд
 *   так не соединяются, близость без совпадения — не соединение;
 * - вывод упорядочивается по (позиция объекта: плата, затем компоненты; позиция вывода
 *   в определении), узел — по первому выводу; номера NET_001, NET_002, …;
 * - выводятся узлы из двух и более выводов, кроме узлов только из выводов гнёзд.
 */

export interface Net {
  id: string;
  /** Ссылки на выводы `componentId.pinId` в каноническом порядке. */
  members: readonly string[];
}

export interface Netlist {
  nets: readonly Net[];
  /** Узел по ключу вывода (только выводы, попавшие в узлы). */
  netByPin: ReadonlyMap<string, Net>;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(item: string): void {
    if (!this.parent.has(item)) this.parent.set(item, item);
  }

  find(item: string): string {
    let root = item;
    for (let next = this.parent.get(root); next !== undefined && next !== root; next = this.parent.get(root)) {
      root = next;
    }
    let current = item;
    while (current !== root) {
      const next = this.parent.get(current) ?? root;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }

  groups(): string[][] {
    const result = new Map<string, string[]>();
    for (const item of this.parent.keys()) {
      const root = this.find(item);
      const group = result.get(root);
      if (group === undefined) result.set(root, [item]);
      else group.push(item);
    }
    return [...result.values()];
  }
}

type NetlistSource = Pick<
  NormalizedCircuit,
  "board" | "components" | "componentOrder" | "connections" | "connectionOrder"
>;

function pointKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function buildNetlist(circuit: NetlistSource): Netlist {
  const instances: PlacedInstance[] = [toPlacedInstance(circuit.board)];
  for (const id of circuit.componentOrder) {
    const component = circuit.components[id];
    if (component !== undefined) instances.push(component);
  }

  // Порядок вывода: [индекс объекта, индекс вывода].
  const order = new Map<string, readonly [number, number]>();
  const socketPins = new Set<string>();
  const socketHoles = new Map<string, string[]>();
  const plugged: [string, string][] = [];
  const seen = new Set<string>();
  const unionFind = new UnionFind();

  instances.forEach((instance, index) => {
    const definition: ComponentDefinition | undefined = getComponentDefinition(instance.type);
    if (definition === undefined || seen.has(instance.id)) return;
    seen.add(instance.id);
    definition.pins.forEach((pin, pinIndex) => {
      order.set(`${instance.id}.${pin.id}`, [index, pinIndex]);
    });
    for (const group of definition.internalConnections ?? []) {
      const [first, ...rest] = group.map((pinId) => `${instance.id}.${pinId}`);
      if (first === undefined) continue;
      for (const other of rest) unionFind.union(first, other);
    }
    if (definition.category === "board") return;
    for (const pin of definition.pins) {
      const point = pinGridPosition(instance, definition, pin.id);
      if (point === undefined) continue;
      const ref = `${instance.id}.${pin.id}`;
      const key = pointKey(point.x, point.y);
      if (definition.socket === true) {
        socketPins.add(ref);
        const holes = socketHoles.get(key);
        if (holes === undefined) socketHoles.set(key, [ref]);
        else holes.push(ref);
      } else {
        plugged.push([ref, key]);
      }
    }
  });

  for (const [ref, key] of plugged) {
    for (const hole of socketHoles.get(key) ?? []) unionFind.union(ref, hole);
  }

  for (const id of circuit.connectionOrder) {
    const connection = circuit.connections[id];
    if (connection === undefined) continue;
    const a = `${connection.from.componentId}.${connection.from.pinId}`;
    const b = `${connection.to.componentId}.${connection.to.pinId}`;
    if (order.has(a) && order.has(b)) unionFind.union(a, b);
  }

  const compare = (a: string, b: string): number => {
    const [ai, ap] = order.get(a) ?? [0, 0];
    const [bi, bp] = order.get(b) ?? [0, 0];
    return ai - bi || ap - bp;
  };
  const groups = unionFind
    .groups()
    .filter(
      (group) =>
        group.length > 1 && group.every((ref) => order.has(ref)) && !group.every((ref) => socketPins.has(ref)),
    )
    .map((group) => group.sort(compare));
  groups.sort((a, b) => compare(a[0] ?? "", b[0] ?? ""));

  const nets: Net[] = groups.map((members, index) => ({
    id: `NET_${String(index + 1).padStart(3, "0")}`,
    members,
  }));
  const netByPin = new Map<string, Net>();
  for (const net of nets) {
    for (const member of net.members) netByPin.set(member, net);
  }
  return { nets, netByPin };
}

const netlistCache = new WeakMap<object, { circuit: NetlistSource; netlist: Netlist }>();

/**
 * Netlist с кэшем: пересчитывается, только если изменились плата, компоненты или
 * соединения (сравнение по ссылкам нормализованного состояния).
 */
export function getNetlist(circuit: NetlistSource): Netlist {
  const cached = netlistCache.get(circuit.components);
  if (
    cached?.circuit.board === circuit.board &&
    cached.circuit.componentOrder === circuit.componentOrder &&
    cached.circuit.connections === circuit.connections &&
    cached.circuit.connectionOrder === circuit.connectionOrder
  ) {
    return cached.netlist;
  }
  const netlist = buildNetlist(circuit);
  netlistCache.set(circuit.components, {
    circuit: {
      board: circuit.board,
      components: circuit.components,
      componentOrder: circuit.componentOrder,
      connections: circuit.connections,
      connectionOrder: circuit.connectionOrder,
    },
    netlist,
  });
  return netlist;
}
