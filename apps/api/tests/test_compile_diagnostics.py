"""Разбор вывода компилятора. Фикстуры — реальный вывод воркера (arduino-cli 1.5.1, avr 1.8.8)."""

from pathlib import Path

from microlab_api.domain.compilation.diagnostics import Diagnostic, parse_diagnostics

FIXTURES = Path(__file__).parent / "fixtures" / "compiler"


def _output(name: str) -> str:
    return (FIXTURES / f"{name}.txt").read_text(encoding="utf-8")


def test_syntax_error_maps_to_sketch_lines() -> None:
    diagnostics = parse_diagnostics(_output("syntax_error"), failed=True)

    assert diagnostics == [
        Diagnostic("sketch.ino", 4, 1, "error", "expected ';' before '}' token"),
        Diagnostic("sketch.ino", 8, 3, "error", "'unknownFunction' was not declared in this scope"),
        Diagnostic("sketch.ino", 7, 7, "warning", "unused variable 'unused' [-Wunused-variable]"),
    ]
    # Номера строк указывают на строки исходного sketch.ino.
    source = (FIXTURES / "syntax_error.ino").read_text(encoding="utf-8").splitlines()
    assert source[8 - 1].strip() == "unknownFunction(5);"
    assert source[7 - 1].strip() == "int unused;"


def test_fatal_error_for_missing_library() -> None:
    assert parse_diagnostics(_output("missing_library"), failed=True) == [
        Diagnostic("sketch.ino", 1, 10, "error", "LiquidCrystal.h: No such file or directory"),
    ]


def test_note_is_kept_with_error() -> None:
    assert parse_diagnostics(_output("note_candidate"), failed=True) == [
        Diagnostic("sketch.ino", 4, 6, "error", "too few arguments to function 'void f(int, int)'"),
        Diagnostic("sketch.ino", 1, 6, "note", "declared here"),
    ]


def test_linker_error_has_line_without_column() -> None:
    assert parse_diagnostics(_output("undefined_reference"), failed=True) == [
        Diagnostic("sketch.ino", 4, None, "error", "undefined reference to `helper()'"),
    ]


def test_linker_error_in_core_file() -> None:
    assert parse_diagnostics(_output("missing_loop"), failed=True) == [
        Diagnostic(
            "arduino-avr-1.8.8/cores/arduino/main.cpp",
            46,
            None,
            "error",
            "undefined reference to `loop'",
        ),
    ]


def test_sketch_too_big_reports_build_errors() -> None:
    diagnostics = parse_diagnostics(_output("too_big"), failed=True)

    assert [d.message for d in diagnostics] == [
        "Sketch too big; see https://support.arduino.cc/hc/en-us/articles/360013825179 "
        "for tips on reducing it.",
        "text section exceeds available space in board",
    ]
    assert all(d.file is None and d.severity == "error" for d in diagnostics)


def test_warnings_on_successful_build() -> None:
    assert parse_diagnostics(_output("warning_only"), failed=False) == [
        Diagnostic("sketch.ino", 2, 7, "warning", "unused variable 'x' [-Wunused-variable]"),
        Diagnostic(
            "sketch.ino",
            8,
            9,
            "warning",
            "comparison between signed and unsigned integer expressions [-Wsign-compare]",
        ),
    ]


def test_tool_error_is_used_only_without_located_errors() -> None:
    output = "collect2: error: ld returned 1 exit status\nError during build: exit status 1\n"
    assert parse_diagnostics(output, failed=True) == [
        Diagnostic(None, None, None, "error", "collect2: ld returned 1 exit status"),
    ]


def test_failed_build_always_has_an_error() -> None:
    assert parse_diagnostics("", failed=True) == [
        Diagnostic(None, None, None, "error", "Compilation failed."),
    ]
    assert parse_diagnostics("Error during build: exit status 1\n", failed=True) == [
        Diagnostic(None, None, None, "error", "exit status 1"),
    ]


def test_successful_build_without_diagnostics() -> None:
    output = "Sketch uses 924 bytes (2%) of program storage space. Maximum is 32256 bytes.\n"
    assert parse_diagnostics(output, failed=False) == []


def test_duplicates_are_removed() -> None:
    line = "sketch.ino:3:1: error: boom\n"
    assert parse_diagnostics(line * 2, failed=True) == [
        Diagnostic("sketch.ino", 3, 1, "error", "boom"),
    ]
