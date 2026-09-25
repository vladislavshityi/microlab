"""Построение netlist: объединение выводов в электрические узлы (nets).

Узлы образуют:

* соединения (провода) документа;
* внутренние соединения определений (несколько выводов GND платы, полосы макетной платы);
* совпадение по сетке: вывод компонента, который лежит точно в той же точке сетки, что и
  вывод компонента-гнезда (``socket``, например отверстие макетной платы), соединён с
  ним. Выводы платы и выводы других гнёзд так не соединяются. Близость без точного
  совпадения координат соединением не является.

Выводы без соединений в netlist не попадают; узлы, состоящие только из выводов гнёзд
(например, пустая полоса макетной платы), тоже не выводятся.

Порядок детерминирован и не зависит от порядка соединений в документе: вывод
упорядочивается по (позиция объекта в документе — сначала плата, затем компоненты;
позиция вывода в определении), узел — по своему первому выводу. Узлы нумеруются
``NET_001``, ``NET_002``, … в этом порядке.
"""

from dataclasses import dataclass

from microlab_api.circuit_schema.definitions import DefinitionRegistry
from microlab_api.circuit_schema.generated.circuit import CircuitDocument
from microlab_api.domain.circuit.geometry import Point, pin_positions

type PinKey = tuple[int, int]


@dataclass(frozen=True, slots=True)
class Net:
    id: str
    members: tuple[str, ...]
    """Ссылки на выводы вида ``componentId.pinId``, в каноническом порядке."""


class _UnionFind:
    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def add(self, item: str) -> None:
        self._parent.setdefault(item, item)

    def find(self, item: str) -> str:
        root = item
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[item] != root:
            self._parent[item], item = root, self._parent[item]
        return root

    def union(self, a: str, b: str) -> None:
        self.add(a)
        self.add(b)
        root_a, root_b = self.find(a), self.find(b)
        if root_a != root_b:
            self._parent[root_b] = root_a

    def groups(self) -> list[list[str]]:
        result: dict[str, list[str]] = {}
        for item in self._parent:
            result.setdefault(self.find(item), []).append(item)
        return list(result.values())


def _connect_by_coincidence(
    placements: list[tuple[bool, list[tuple[str, Point]]]], union_find: _UnionFind
) -> set[str]:
    """Соединяет выводы компонентов с выводами гнёзд в той же точке сетки.

    Возвращает множество выводов гнёзд.
    """
    holes: dict[Point, list[str]] = {}
    for is_socket, placed in placements:
        if is_socket:
            for ref, point in placed:
                holes.setdefault(point, []).append(ref)
    for is_socket, placed in placements:
        if not is_socket:
            for ref, point in placed:
                for hole in holes.get(point, ()):
                    union_find.union(ref, hole)
    return {ref for refs in holes.values() for ref in refs}


def build_netlist(document: CircuitDocument, registry: DefinitionRegistry) -> list[Net]:
    """Строит nets документа.

    Ожидает документ без ошибок ``check_references``: соединения с неизвестными
    объектами или выводами пропускаются, повторяющиеся id объектов учитываются по
    первому вхождению.
    """
    board = document.board
    instances = [(board.id, board.type, board.position, board.rotation)]
    instances += [(c.id, c.type, c.position, c.rotation) for c in document.components]

    order: dict[str, PinKey] = {}
    placements: list[tuple[bool, list[tuple[str, Point]]]] = []
    seen: set[str] = set()
    union_find = _UnionFind()
    for index, (instance_id, component_type, position, rotation) in enumerate(instances):
        definition = registry.get(component_type)
        if definition is None or instance_id in seen:
            continue
        seen.add(instance_id)
        for pin_index, pin in enumerate(definition.pins):
            order[f"{instance_id}.{pin.id}"] = (index, pin_index)
        for group in definition.internal_connections or []:
            first, *rest = (f"{instance_id}.{pin_id}" for pin_id in group.root)
            for other in rest:
                union_find.union(first, other)
        if definition.category == "board":
            continue
        placed = [
            (f"{instance_id}.{pin_id}", point)
            for pin_id, point in pin_positions(definition, position, rotation).items()
        ]
        placements.append((bool(definition.socket), placed))

    socket_pins = _connect_by_coincidence(placements, union_find)

    for connection in document.connections:
        a = f"{connection.from_.component_id}.{connection.from_.pin_id}"
        b = f"{connection.to.component_id}.{connection.to.pin_id}"
        if a in order and b in order:
            union_find.union(a, b)

    groups = [
        sorted(group, key=order.__getitem__)
        for group in union_find.groups()
        if len(group) > 1
        and all(ref in order for ref in group)
        and not all(ref in socket_pins for ref in group)
    ]
    groups.sort(key=lambda group: order[group[0]])
    return [
        Net(id=f"NET_{number:03d}", members=tuple(group))
        for number, group in enumerate(groups, start=1)
    ]
