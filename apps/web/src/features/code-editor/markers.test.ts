import { describe, expect, it } from "vitest";

import type { CompileDiagnostic } from "@/api/schemas";

import { diagnosticsToMarkers } from "./markers";

const SEVERITIES = { Error: 8, Warning: 4, Info: 2 };

function diag(partial: Partial<CompileDiagnostic>): CompileDiagnostic {
  return { file: "sketch.ino", line: 1, column: 1, severity: "error", message: "m", ...partial };
}

describe("diagnosticsToMarkers", () => {
  it("maps sketch diagnostics to markers from the column to the end of the line", () => {
    const markers = diagnosticsToMarkers(
      [
        diag({ line: 5, column: 3, message: "'foo' was not declared in this scope" }),
        diag({ line: 2, column: null, severity: "warning", message: "unused" }),
        diag({ line: 2, column: 4, severity: "note", message: "candidate" }),
      ],
      SEVERITIES,
      10,
      () => 20,
    );
    expect(markers).toEqual([
      {
        severity: 8,
        message: "'foo' was not declared in this scope",
        source: "arduino-cli",
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 5,
        endColumn: 20,
      },
      expect.objectContaining({ severity: 4, startLineNumber: 2, startColumn: 1 }),
      expect.objectContaining({ severity: 2, startLineNumber: 2, startColumn: 4 }),
    ]);
  });

  it("skips diagnostics without a sketch line and clamps stale lines", () => {
    const markers = diagnosticsToMarkers(
      [
        diag({ file: null, line: null, column: null, message: "collect2: error" }),
        diag({ file: "arduino-avr-1.8.8/cores/arduino/main.cpp", line: 43 }),
        diag({ line: 99, column: 50 }),
      ],
      SEVERITIES,
      3,
      (line) => (line === 3 ? 8 : 1),
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ startLineNumber: 3, startColumn: 8, endColumn: 9 });
  });
});
