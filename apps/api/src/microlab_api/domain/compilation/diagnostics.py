"""Разбор вывода avr-gcc / arduino-cli в структурированные диагностики.

arduino-cli при препроцессинге вставляет директивы ``#line``, поэтому avr-gcc сообщает
номера строк исходного ``sketch.ino``. Воркер компиляции заменяет внутренние пути:
файл скетча — ``sketch.ino``, файлы ядра — ``arduino-avr-1.8.8/...``.

Распознаются строки:

* ``file:line:col: severity: message`` — ошибки и предупреждения компилятора;
* ``file:line: message`` — ошибки компоновщика (``undefined reference`` и т. п.);
* ``tool: error: message`` — ошибки инструментов без привязки к файлу (``collect2``);
* ``Error during build: ...`` — итоговая ошибка arduino-cli.

Строки фрагмента исходника с ``^``, контекст (``In function``, ``In file included from``)
и прочий вывод пропускаются.
"""

import re
from dataclasses import dataclass
from typing import Literal

type Severity = Literal["error", "warning", "note"]

SKETCH_FILE = "sketch.ino"

_COMPILER = re.compile(
    r"^(?P<file>[^\s:][^:]*?):(?P<line>\d+):(?P<column>\d+): "
    r"(?P<severity>fatal error|error|warning|note): (?P<message>.+)$"
)
_LINKER = re.compile(
    r"^(?P<file>[^\s:][^:]*?\.(?:ino|c|cc|cpp|cxx|h|hh|hpp|S|s)):(?P<line>\d+): "
    r"(?P<message>.+)$"
)
_TOOL = re.compile(r"^(?P<tool>[\w.+-]+): (?P<severity>fatal error|error): (?P<message>.+)$")
_BUILD_ERROR = re.compile(r"^Error during build: (?P<message>.+)$")
_SKETCH_TOO_BIG = re.compile(r"^Sketch too big;")


@dataclass(frozen=True, slots=True)
class Diagnostic:
    file: str | None
    line: int | None
    column: int | None
    severity: Severity
    message: str


def _severity(raw: str) -> Severity:
    if raw in ("error", "fatal error"):
        return "error"
    if raw == "warning":
        return "warning"
    return "note"


def parse_diagnostics(output: str, *, failed: bool) -> list[Diagnostic]:
    """Возвращает диагностики в порядке появления, без дубликатов.

    Если сборка завершилась ошибкой, результат всегда содержит хотя бы одну ошибку:
    при отсутствии диагностик с привязкой к файлу добавляются ошибки инструментов
    или итоговое сообщение arduino-cli.
    """
    located: list[Diagnostic] = []
    tools: list[Diagnostic] = []
    build_errors: list[Diagnostic] = []

    for raw_line in output.splitlines():
        line = raw_line.rstrip()
        if match := _COMPILER.match(line):
            located.append(
                Diagnostic(
                    file=match["file"],
                    line=int(match["line"]),
                    column=int(match["column"]),
                    severity=_severity(match["severity"]),
                    message=match["message"],
                )
            )
        elif match := _LINKER.match(line):
            located.append(
                Diagnostic(
                    file=match["file"],
                    line=int(match["line"]),
                    column=None,
                    severity="error",
                    message=match["message"],
                )
            )
        elif match := _TOOL.match(line):
            tools.append(_unlocated_error(f"{match['tool']}: {match['message']}"))
        elif _SKETCH_TOO_BIG.match(line):
            build_errors.append(_unlocated_error(line))
        elif match := _BUILD_ERROR.match(line):
            build_errors.append(_unlocated_error(match["message"]))

    result = _unique(located)
    if not failed or any(d.severity == "error" for d in result):
        return result
    fallback = _unique(tools) or _unique(build_errors)
    return result + (fallback or [_unlocated_error("Compilation failed.")])


def _unlocated_error(message: str) -> Diagnostic:
    return Diagnostic(file=None, line=None, column=None, severity="error", message=message)


def _unique(items: list[Diagnostic]) -> list[Diagnostic]:
    return list(dict.fromkeys(items))
