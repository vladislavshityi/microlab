import { useEffect, useRef } from "react";

import { t } from "@/i18n/t";
import { runShortcut } from "@/features/workspace/shortcuts";
import { useEditorStore } from "@/stores/editor-store";
import { useUiStore } from "@/stores/ui-store";

import { applyEditorTheme, monaco } from "./monaco";

/** Моноширинный шрифт интерфейса — тот же, что в токене --font-code. */
function codeFontFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-code").trim();
  return value === "" ? "monospace" : value;
}

/**
 * Редактор кода скетча на Monaco. Загружается отдельным чанком (React.lazy).
 * Текст синхронизируется с editorStore; экземпляр редактора живёт, пока смонтирован
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

    return () => {
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
