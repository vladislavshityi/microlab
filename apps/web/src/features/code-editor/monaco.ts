/**
 * Подключение Monaco Editor из локального пакета monaco-editor (без загрузки с CDN).
 *
 * Импортируются только ядро редактора, стандартные возможности (поиск и замена,
 * сворачивание, мультикурсор и т. п.) и подсветка C/C++ — скетч является программой
 * на C++. Языковые сервисы TypeScript/JSON/CSS/HTML и их workers не подключаются.
 */
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/cpp/register";

import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

import type { ResolvedTheme } from "@/lib/theme";

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

const THEME_NAME: Record<ResolvedTheme, string> = {
  light: "microlab-light",
  dark: "microlab-dark",
};

/** Резервные цвета, если токен темы не удалось прочитать. */
const FALLBACK: Record<ResolvedTheme, { background: string; foreground: string }> = {
  light: { background: "#ffffff", foreground: "#111111" },
  dark: { background: "#18181b", foreground: "#f4f4f5" },
};

let colorContext: CanvasRenderingContext2D | null | undefined;

/**
 * Переводит значение CSS-токена (в том числе oklch) в #rrggbb, понятный Monaco:
 * браузер сам отрисовывает цвет в 1 пиксель canvas, откуда читается результат в sRGB.
 */
function tokenToHex(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (value === "") {
    return fallback;
  }
  if (colorContext === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (colorContext === null) {
    return fallback;
  }
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = fallback;
  colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = colorContext.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Определяет тему Monaco из текущих токенов приложения и применяет её.
 * Вызывается после смены класса темы на <html>.
 */
export function applyEditorTheme(theme: ResolvedTheme): void {
  const fallback = FALLBACK[theme];
  const background = tokenToHex("--background", fallback.background);
  const foreground = tokenToHex("--foreground", fallback.foreground);
  const muted = tokenToHex("--muted", background);
  const mutedForeground = tokenToHex("--muted-foreground", foreground);
  const border = tokenToHex("--border", background);
  const popover = tokenToHex("--popover", background);
  const ring = tokenToHex("--ring", foreground);

  monaco.editor.defineTheme(THEME_NAME[theme], {
    base: theme === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorGutter.background": background,
      "editorLineNumber.foreground": mutedForeground,
      "editorLineNumber.activeForeground": foreground,
      "editor.lineHighlightBackground": muted,
      "editor.lineHighlightBorder": muted,
      "editorCursor.foreground": foreground,
      "editorWidget.background": popover,
      "editorWidget.border": border,
      "focusBorder": ring,
    },
  });
  monaco.editor.setTheme(THEME_NAME[theme]);
}

export { monaco };
