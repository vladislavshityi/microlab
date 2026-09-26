import { getComponentDefinition } from "@microlab/circuit-schema";

import { ProjectName } from "@/features/projects/project-name";
import { ProjectsMenu } from "@/features/projects/projects-menu";
import { SaveStatusControl } from "@/features/projects/save-status";
import { localized } from "@/i18n/localized";
import { t } from "@/i18n/t";
import { useCircuitStore } from "@/stores/circuit-store";

import { ThemeMenu } from "./theme-menu";

/**
 * Верхняя панель: проекты, название, плата, состояние сохранения. Кнопок запуска и
 * остановки нет, пока нет симуляции, чтобы не создавать видимость работающих действий.
 */
export function Toolbar() {
  const boardType = useCircuitStore((state) => state.board.type);
  const board = getComponentDefinition(boardType);
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b px-3">
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <span className="font-semibold">{t("app.name")}</span>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <ProjectsMenu />
        <ProjectName />
        <span className="truncate text-xs text-muted-foreground">{board === undefined ? t("workspace.board.none") : localized(board.displayName)}</span>
      </div>
      <div className="flex items-center gap-2">
        <SaveStatusControl />
        <ThemeMenu />
      </div>
    </header>
  );
}
