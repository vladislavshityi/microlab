"""Circuit Model: разбор документа схемы, проверка ссылок и построение netlist."""

from microlab_api.domain.circuit.issues import Issue, IssueCode, Severity, has_errors
from microlab_api.domain.circuit.netlist import Net, build_netlist
from microlab_api.domain.circuit.parser import SUPPORTED_SCHEMA_VERSION, ParseResult, parse_circuit
from microlab_api.domain.circuit.references import check_references

__all__ = [
    "SUPPORTED_SCHEMA_VERSION",
    "Issue",
    "IssueCode",
    "Net",
    "ParseResult",
    "Severity",
    "build_netlist",
    "check_references",
    "has_errors",
    "parse_circuit",
]
