import { lazy, Suspense } from "react";

import { t } from "@/i18n/t";

const CodeEditor = lazy(() => import("./code-editor"));

/** Сочетание Monaco «Tab перемещает фокус» зависит от платформы. */
function tabFocusShortcut(): string {
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  return isMac ? "Ctrl+Shift+M" : "Ctrl+M";
}

/** Вкладка «Код»: подсказка по клавиатуре и редактор, загружаемый отдельным чанком. */
export function CodeEditorPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
        {t("editor.tabFocusHint", { shortcut: tabFocusShortcut() })}
      </p>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <p role="status" className="p-3 text-xs text-muted-foreground">
              {t("editor.loading")}
            </p>
          }
        >
          <CodeEditor />
        </Suspense>
      </div>
    </div>
  );
}
