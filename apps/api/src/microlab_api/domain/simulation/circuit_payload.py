"""Преобразование документа схемы в описание схемы для worker симуляции.

Worker получает связность как netlist (``[{id, members: ["компонент.вывод"]}]``) и список
компонентов с их свойствами; значения свойств по умолчанию и электрические модели worker
берёт из тех же определений компонентов. Netlist строится тем же построителем, что и при
проверке схемы, поэтому симуляция и проверка видят одну и ту же связность.
"""

from typing import Any

from microlab_api.circuit_schema.definitions import DefinitionRegistry
from microlab_api.circuit_schema.generated.circuit import CircuitDocument
from microlab_api.domain.circuit import Net


def build_circuit_payload(
    document: CircuitDocument, nets: list[Net], registry: DefinitionRegistry
) -> dict[str, Any]:
    """Описание схемы для команды ``start`` сервиса симуляции.

    Компоненты неизвестных типов сюда не попадают (документ с ними не проходит проверку);
    известные, но не моделируемые worker компоненты передаются — worker отвечает на них
    предупреждением ``UNSUPPORTED_COMPONENT``.
    """
    return {
        "board": {"id": document.board.id, "type": document.board.type},
        "netlist": [{"id": net.id, "members": list(net.members)} for net in nets],
        "components": [
            {"id": component.id, "type": component.type, "properties": dict(component.properties)}
            for component in document.components
            if registry.get(component.type) is not None
        ],
    }
