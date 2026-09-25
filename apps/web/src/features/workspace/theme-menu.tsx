import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { useUiStore } from "@/stores/ui-store";

const THEME_LABEL: Record<ThemePreference, PlainTranslationKey> = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
};

const THEME_ICON: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

function isThemePreference(value: string): value is ThemePreference {
  return THEME_PREFERENCES.some((preference) => preference === value);
}

/** Переключатель темы: «Системная», «Светлая», «Тёмная». */
export function ThemeMenu() {
  const preference = useUiStore((state) => state.themePreference);
  const setThemePreference = useUiStore((state) => state.setThemePreference);
  const Icon = THEME_ICON[preference];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("theme.menu.trigger", { theme: t(THEME_LABEL[preference]) })}
        >
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("theme.menu.label")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) {
              setThemePreference(value);
            }
          }}
        >
          {THEME_PREFERENCES.map((option) => {
            const OptionIcon = THEME_ICON[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <OptionIcon aria-hidden="true" />
                {t(THEME_LABEL[option])}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
