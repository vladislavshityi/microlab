import { readStorage, writeStorage } from "@/lib/storage";

/**
 * Тема оформления.
 *
 * Выбор пользователя («системная», «светлая», «тёмная») хранится в localStorage.
 * Фактическая тема задаётся классом `.dark` на <html>. Тот же ключ и та же логика
 * продублированы во встроенном скрипте index.html, который применяет тему до первой
 * отрисовки (без вспышки светлой темы) — при изменении синхронизировать оба места.
 */

export const THEME_STORAGE_KEY = "microlab.theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export type ResolvedTheme = "light" | "dark";

export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value);
}

/** Сохранённый выбор темы; при отсутствии или повреждении значения — «системная». */
export function readThemePreference(): ThemePreference {
  const stored = readStorage(THEME_STORAGE_KEY);
  return isThemePreference(stored) ? stored : "system";
}

export function writeThemePreference(preference: ThemePreference): void {
  writeStorage(THEME_STORAGE_KEY, preference);
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_SCHEME_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

/** Применяет тему к корневому элементу документа. */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}
