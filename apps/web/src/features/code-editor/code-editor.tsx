import { useEffect, useRef } from "react";

import { t } from "@/i18n/t";
import { runShortcut } from "@/features/workspace/shortcuts";
import { useEditorStore } from "@/stores/editor-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useUiStore } from "@/stores/ui-store";

import { diagnosticsToMarkers, MARKER_OWNER } from "./markers";
import { applyEditorTheme, monaco } from "./monaco";

/** Моноширинный шрифт интерфейса — тот же, что в токене --font-code. */
function codeFontFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim();
  return value === "" ? "monospace" : value;
}

/**
 * Редактор кода скетча на Monaco. Загружается отдельным чанком (React.lazy).
 * Текст синхронизируется с editorStore в обе стороны; экземпляр редактора живёт, пока смонтирован
 * компонент.
 */
export default function CodeEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedTheme = useUiStore((state) => state.resolvedTheme);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    applyEditorTheme(useUiStore.getState().resolvedTheme);

    const editor = monaco.editor.create(container, {
      value: useEditorStore.getState().code,
      language: "cpp",
      ariaLabel: t("editor.label"),
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: "on",
      fontFamily: codeFontFamily(),
      fontSize: 13,
      lineHeight: 20,
      tabSize: 2,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      fixedOverflowWidgets: true,
    });

    // Сочетания регистрируются в самом редакторе: иначе Cmd/Ctrl+Enter обрабатывался бы
    // как «вставить строку ниже», а Cmd/Ctrl+S мог бы дойти до браузера.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      runShortcut("save");
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runShortcut("run");
    });

    const subscription = editor.onDidChangeModelContent(() => {
      useEditorStore.getState().setCode(editor.getValue());
    });

    // Открыт другой проект: текст заменяется, история правок редактора сбрасывается
    // (setValue очищает стек отмены модели).
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.documentVersion !== previous.documentVersion) {
        editor.setValue(state.code);
      }
    });

    // Диагностики последней компиляции — маркеры в тексте. Правка кода их не снимает
    // (как в других IDE): они обновляются при следующей компиляции.
    const applyMarkers = () => {
      const model = editor.getModel();
      if (model === null) return;
      const diagnostics = useSimulationStore.getState().compilation?.diagnostics ?? [];
      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        diagnosticsToMarkers(diagnostics, monaco.MarkerSeverity, model.getLineCount(), (line) =>
          model.getLineMaxColumn(line),
        ),
      );
    };
    applyMarkers();
    const unsubscribeMarkers = useSimulationStore.subscribe((state, previous) => {
      if (state.compilation !== previous.compilation) applyMarkers();
    });

    // Переход к строке диагностики из панели «Проблемы».
    const unsubscribeReveal = useEditorStore.subscribe((state, previous) => {
      const reveal = state.reveal;
      if (reveal === null || reveal === previous.reveal) return;
      const position = { lineNumber: reveal.line, column: reveal.column };
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
    });

    return () => {
      unsubscribeReveal();
      unsubscribeMarkers();
      unsubscribe();
      subscription.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
    };
  }, []);

  useEffect(() => {
    applyEditorTheme(resolvedTheme);
  }, [resolvedTheme]);

  return <div ref={containerRef} className="h-full w-full" data-testid="code-editor" />;
}
