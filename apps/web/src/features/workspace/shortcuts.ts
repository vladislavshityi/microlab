import type { PlainTranslationKey } from "@/i18n/t";
import { useCircuitStore } from "@/stores/circuit-store";
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

/** Отмена и повтор изменений схемы. */
export type HistoryAction = "undo" | "redo";

/**
 * Cmd/Ctrl+Z — отмена, Cmd/Ctrl+Shift+Z (и Ctrl+Y) — повтор. Клавиши определяются по
 * физическому коду, чтобы сочетания работали и в русской раскладке.
 */
export function matchHistoryShortcut(event: KeyboardEvent): HistoryAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return null;
  }
  if (event.code === "KeyZ" || event.key.toLowerCase() === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  if (event.ctrlKey && !event.shiftKey && (event.code === "KeyY" || event.key.toLowerCase() === "y")) {
    return "redo";
  }
  return null;
}

export function runHistoryShortcut(action: HistoryAction): void {
  const store = useCircuitStore.getState();
  if (action === "undo") {
    store.undo();
  } else {
    store.redo();
  }
}
