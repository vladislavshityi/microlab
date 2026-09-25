"""Проверка схемы: структура документа, ссылки, netlist и электрические правила."""

from dataclasses import dataclass, field

from microlab_api.circuit_schema.definitions import DefinitionRegistry
from microlab_api.domain.circuit import Issue, Net, build_netlist, check_references, parse_circuit
from microlab_api.domain.validation.context import build_context
from microlab_api.domain.validation.rules import check_electrical


@dataclass(frozen=True, slots=True)
class ValidationResult:
    issues: list[Issue] = field(default_factory=list)
    nets: list[Net] = field(default_factory=list)


def validate_circuit(raw: object, registry: DefinitionRegistry) -> ValidationResult:
    """Проверяет документ схемы из JSON-данных.

    Если документ не разобран (неверная структура или версия формата), возвращаются
    только ошибки разбора. Иначе — ошибки ссылок, затем электрические замечания; при
    ошибках ссылок электрические правила работают по той части схемы, которая понятна.
    """
    parsed = parse_circuit(raw)
    if parsed.document is None:
        return ValidationResult(issues=parsed.issues)
    document = parsed.document
    issues = check_references(document, registry)
    nets = build_netlist(document, registry)
    issues += check_electrical(build_context(document, registry, nets))
    return ValidationResult(issues=issues, nets=nets)
