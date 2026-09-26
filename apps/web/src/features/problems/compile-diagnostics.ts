import type { CompileDiagnostic } from "@/api/schemas";
import { SKETCH_FILE } from "@/features/code-editor/markers";
import { useEditorStore } from "@/stores/editor-store";
import { useUiStore } from "@/stores/ui-store";

import type { IssueCounts } from "./issue-format";

export function countDiagnostics(diagnostics: readonly CompileDiagnostic[]): IssueCounts {
  const counts: IssueCounts = { errors: 0, warnings: 0, infos: 0 };
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") counts.errors += 1;
    else if (diagnostic.severity === "warning") counts.warnings += 1;
    else counts.infos += 1;
  }
  return counts;
}

/** «sketch.ino:5:3» или «sketch.ino» для сообщения без строки. */
export function diagnosticLocation(diagnostic: CompileDiagnostic): string {
  if (diagnostic.file === null) return "";
  if (diagnostic.line === null) return diagnostic.file;
  return diagnostic.column === null
    ? `${diagnostic.file}:${diagnostic.line}`
    : `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
}

/** Открывает вкладку кода и переводит курсор к строке диагностики. */
export function revealDiagnostic(diagnostic: CompileDiagnostic): void {
  if (diagnostic.file !== SKETCH_FILE || diagnostic.line === null) return;
  const { line } = diagnostic;
  const column = diagnostic.column ?? 1;
  useUiStore.getState().setBottomTab("code");
  // Переход — после того как вкладка кода станет видимой (иначе редактор не знает размеров).
  requestAnimationFrame(() => {
    useEditorStore.getState().revealPosition(line, column);
  });
}
