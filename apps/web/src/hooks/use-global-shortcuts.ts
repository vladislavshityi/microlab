import { useEffect } from "react";

import {
  matchHistoryShortcut,
  matchShortcut,
  runHistoryShortcut,
  runShortcut,
} from "@/features/workspace/shortcuts";
import { isTextInputTarget } from "@/lib/platform";

/**
 * Перехватывает Cmd/Ctrl+S и Cmd/Ctrl+Enter на уровне окна, а также отмену и повтор
 * изменений схемы (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) — кроме полей ввода и редактора кода,
 * где эти сочетания отменяют правку текста.
 *
 * Обработчик работает на фазе всплытия: внутри редактора кода эти сочетания
 * регистрируются как команды редактора, которые останавливают всплытие, поэтому
 * действие не выполняется дважды. Остальные клавиши не трогаются, чтобы не ломать
 * встроенные сочетания редактора и браузера.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const history = matchHistoryShortcut(event);
      if (history !== null) {
        if (!isTextInputTarget(event.target)) {
          event.preventDefault();
          runHistoryShortcut(history);
        }
        return;
      }
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
