import type { CompileDiagnostic } from "@/api/schemas";

/** Файл скетча в диагностиках компилятора (пути внутри воркера заменены). */
export const SKETCH_FILE = "sketch.ino";

/** Значения серьёзности маркеров Monaco (monaco.MarkerSeverity). */
export interface MarkerSeverities {
  Error: number;
  Warning: number;
  Info: number;
}

export interface EditorMarker {
  severity: number;
  message: string;
  source: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** Источник маркеров компилятора в модели редактора. */
export const MARKER_OWNER = "arduino-cli";

/**
 * Диагностики компилятора → маркеры редактора. В редакторе отмечаются только сообщения
 * с привязкой к строке скетча; маркер — от указанного столбца до конца строки.
 * Номера строк за пределами текста (код изменили после компиляции) ограничиваются.
 */
export function diagnosticsToMarkers(
  diagnostics: readonly CompileDiagnostic[],
  severities: MarkerSeverities,
  lineCount: number,
  lineMaxColumn: (line: number) => number,
): EditorMarker[] {
  const markers: EditorMarker[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.file !== SKETCH_FILE || diagnostic.line === null || lineCount < 1) continue;
    const line = Math.min(Math.max(diagnostic.line, 1), lineCount);
    const maxColumn = lineMaxColumn(line);
    const column = Math.min(Math.max(diagnostic.column ?? 1, 1), maxColumn);
    markers.push({
      severity:
        diagnostic.severity === "error"
          ? severities.Error
          : diagnostic.severity === "warning"
            ? severities.Warning
            : severities.Info,
      message: diagnostic.message,
      source: MARKER_OWNER,
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn: Math.max(maxColumn, column + 1),
    });
  }
  return markers;
}
