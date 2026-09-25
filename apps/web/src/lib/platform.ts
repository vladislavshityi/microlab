/** macOS и iOS: модификатор сочетаний — Cmd, а не Ctrl. */
export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** Подпись модификатора для подсказок: «⌘» на macOS, «Ctrl» на остальных. */
export function modifierLabel(): string {
  return isApplePlatform() ? "⌘" : "Ctrl+";
}

/**
 * Элемент, в котором клавиши принадлежат вводу текста или виджету: поля ввода,
 * редактор кода, меню и диалоги. Сочетания схемы там не срабатывают.
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return (
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], .monaco-editor, [role="menu"], [role="dialog"], [role="listbox"]',
    ) !== null
  );
}
