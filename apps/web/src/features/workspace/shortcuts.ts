import type { PlainTranslationKey } from "@/i18n/t";
import { useUiStore } from "@/stores/ui-store";

/** Глобальные сочетания клавиш рабочего пространства. */
export type ShortcutAction = "save" | "run";

/**
 * Сохранение и запуск ещё не реализованы: сочетание не должно открывать браузерный
 * диалог «Сохранить страницу», а пользователь получает честное уведомление.
 */
const UNAVAILABLE_NOTICE: Record<ShortcutAction, PlainTranslationKey> = {
  save: "notice.saveUnavailable",
  run: "notice.runUnavailable",
};

/**
 * Определяет действие по нажатию: Cmd/Ctrl+S — сохранение, Cmd/Ctrl+Enter — запуск.
 * Клавиша S определяется по физическому коду, чтобы сочетание работало и в русской
 * раскладке.
 */
export function matchShortcut(event: KeyboardEvent): ShortcutAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return null;
  }
  if (event.code === "KeyS" || event.key.toLowerCase() === "s") {
    return "save";
  }
  if (event.key === "Enter") {
    return "run";
  }
  return null;
}

export function runShortcut(action: ShortcutAction): void {
  useUiStore.getState().showNotice(UNAVAILABLE_NOTICE[action]);
}
