import { useEffect } from "react";

import { matchShortcut, runShortcut } from "@/features/workspace/shortcuts";

/**
 * Перехватывает Cmd/Ctrl+S и Cmd/Ctrl+Enter на уровне окна.
 *
 * Обработчик работает на фазе всплытия: внутри редактора кода эти сочетания
 * регистрируются как команды редактора, которые останавливают всплытие, поэтому
 * действие не выполняется дважды. Остальные клавиши не трогаются, чтобы не ломать
 * встроенные сочетания редактора и браузера.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = matchShortcut(event);
      if (action === null) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        runShortcut(action);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
