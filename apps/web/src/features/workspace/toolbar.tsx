import { t } from "@/i18n/t";

import { ThemeMenu } from "./theme-menu";

/**
 * Верхняя панель. Кнопки запуска, остановки и сохранения появятся вместе
 * с соответствующими функциями; до тех пор их нет, чтобы не создавать видимость
 * работающих действий.
 */
export function Toolbar() {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b px-3">
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <span className="font-semibold">{t("app.name")}</span>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <span className="truncate">{t("workspace.project.untitled")}</span>
        <span className="truncate text-xs text-muted-foreground">{t("workspace.board.none")}</span>
      </div>
      <ThemeMenu />
    </header>
  );
}
