import { getComponentDefinition } from "@microlab/circuit-schema";

import { UserMenu } from "@/features/auth/user-menu";
import { ProjectName } from "@/features/projects/project-name";
import { ProjectsMenu } from "@/features/projects/projects-menu";
import { SaveStatusControl } from "@/features/projects/save-status";
import { SimulationControls } from "@/features/simulation/simulation-controls";
import { localized } from "@/i18n/localized";
import { t } from "@/i18n/t";
import { useCircuitStore } from "@/stores/circuit-store";
import { useProjectStore } from "@/stores/project-store";

import { ThemeMenu } from "./theme-menu";

/** Верхняя панель: проекты, название, плата, управление симуляцией, состояние сохранения. */
export function Toolbar() {
  const boardType = useCircuitStore((state) => state.board.type);
  const board = getComponentDefinition(boardType);
  // Режим просмотра: без списка проектов, запуска и сохранения.
  const readOnly = useProjectStore((state) => state.readOnly !== null);
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-4 border-b px-3">
      <div className="flex min-w-0 items-center gap-3 text-sm">
        <span className="font-semibold">{t("app.name")}</span>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        {readOnly ? null : <ProjectsMenu />}
        <ProjectName />
        <span className="truncate text-xs text-muted-foreground">{board === undefined ? t("workspace.board.none") : localized(board.displayName)}</span>
      </div>
      {readOnly ? <span /> : <SimulationControls />}
      <div className="flex items-center gap-2">
        {readOnly ? null : <SaveStatusControl />}
        <ThemeMenu />
        <UserMenu />
      </div>
    </header>
  );
}
