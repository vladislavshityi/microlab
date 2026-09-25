import type { GridPoint } from "@microlab/circuit-schema";
import { create } from "zustand";

import type { PlainTranslationKey } from "@/i18n/t";
import {
  applyTheme,
  readThemePreference,
  resolveTheme,
  systemPrefersDark,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

/** Вкладки нижней панели. */
export const BOTTOM_TABS = ["code", "console", "serial", "problems"] as const;

export type BottomTab = (typeof BOTTOM_TABS)[number];

/** Сворачиваемые панели рабочего пространства. */
export type CollapsiblePanel = "components" | "properties" | "bottom";

/** Короткое уведомление в строке состояния (например, о ещё не доступной функции). */
export interface Notice {
  /** Уникален для каждого показа: повторное уведомление перезапускает таймер скрытия. */
  id: number;
  message: PlainTranslationKey;
}

interface UiState {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  bottomTab: BottomTab;
  collapsed: Record<CollapsiblePanel, boolean>;
  notice: Notice | null;
  /** Центр видимой области холста в единицах сетки (сюда добавляются компоненты по щелчку). */
  canvasCenter: GridPoint | null;
  /** Запрошен фокус на поиске компонентов (клавиша A на холсте); сбрасывается после фокуса. */
  componentSearchRequested: boolean;

  setThemePreference: (preference: ThemePreference) => void;
  setResolvedTheme: (theme: ResolvedTheme) => void;
  setBottomTab: (tab: BottomTab) => void;
  setCollapsed: (panel: CollapsiblePanel, collapsed: boolean) => void;
  showNotice: (message: PlainTranslationKey) => void;
  dismissNotice: (id: number) => void;
  setCanvasCenter: (center: GridPoint) => void;
  requestComponentSearch: () => void;
  consumeComponentSearch: () => void;
}

let nextNoticeId = 1;

function initialThemeState(): Pick<UiState, "themePreference" | "resolvedTheme"> {
  const themePreference = readThemePreference();
  const resolvedTheme = resolveTheme(themePreference, systemPrefersDark());
  // Встроенный скрипт index.html уже применил тему; повтор гарантирует согласованность,
  // если скрипт не выполнился (например, в тестах).
  applyTheme(resolvedTheme);
  return { themePreference, resolvedTheme };
}

/**
 * Состояние интерфейса: тема, активная вкладка нижней панели, свёрнутость панелей,
 * уведомления. Размеры панелей хранит сама библиотека панелей (см. layout-storage).
 */
export const useUiStore = create<UiState>()((set) => ({
  ...initialThemeState(),
  bottomTab: "code",
  collapsed: { components: false, properties: false, bottom: false },
  notice: null,
  canvasCenter: null,
  componentSearchRequested: false,

  // Класс темы меняется синхронно, до перерисовки React: компоненты, читающие значения
  // CSS-токенов (редактор кода), получают уже актуальные цвета.
  setThemePreference: (preference) => {
    writeThemePreference(preference);
    const resolvedTheme = resolveTheme(preference, systemPrefersDark());
    applyTheme(resolvedTheme);
    set({ themePreference: preference, resolvedTheme });
  },
  setResolvedTheme: (theme) => {
    applyTheme(theme);
    set({ resolvedTheme: theme });
  },
  setBottomTab: (tab) => {
    set({ bottomTab: tab });
  },
  setCollapsed: (panel, collapsed) => {
    set((state) =>
      state.collapsed[panel] === collapsed
        ? state
        : { collapsed: { ...state.collapsed, [panel]: collapsed } },
    );
  },
  showNotice: (message) => {
    set({ notice: { id: nextNoticeId++, message } });
  },
  dismissNotice: (id) => {
    set((state) => (state.notice?.id === id ? { notice: null } : state));
  },
  setCanvasCenter: (center) => {
    set({ canvasCenter: center });
  },
  requestComponentSearch: () => {
    set({ componentSearchRequested: true });
  },
  consumeComponentSearch: () => {
    set({ componentSearchRequested: false });
  },
}));
