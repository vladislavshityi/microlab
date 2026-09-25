import { Copy, Maximize, Redo2, RotateCw, Trash2, Undo2 } from "lucide-react";

import { IconButton } from "@/features/workspace/icon-button";
import { t } from "@/i18n/t";
import { modifierLabel } from "@/lib/platform";
import { selectCanRedo, selectCanUndo, useCircuitStore } from "@/stores/circuit-store";

/** Панель действий холста; у каждой кнопки есть сочетание клавиш. */
export function CanvasToolbar({ onFitView }: { onFitView: () => void }) {
  const canUndo = useCircuitStore(selectCanUndo);
  const canRedo = useCircuitStore(selectCanRedo);
  const canRotate = useCircuitStore((state) => state.selection.componentIds.length > 0);
  const canDuplicate = useCircuitStore((state) =>
    state.selection.componentIds.some((id) => id !== state.board.id),
  );
  const canDelete = useCircuitStore(
    (state) =>
      state.selection.connectionIds.length > 0 ||
      state.selection.componentIds.some((id) => id !== state.board.id),
  );
  const mod = modifierLabel();
  return (
    <div
      role="toolbar"
      aria-label={t("canvas.toolbar.label")}
      className="flex items-center gap-0.5 rounded-md border bg-card p-0.5"
    >
      <IconButton
        label={t("canvas.action.undo", { shortcut: `${mod}Z` })}
        disabled={!canUndo}
        onClick={() => {
          useCircuitStore.getState().undo();
        }}
      >
        <Undo2 aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t("canvas.action.redo", { shortcut: `${mod}⇧Z` })}
        disabled={!canRedo}
        onClick={() => {
          useCircuitStore.getState().redo();
        }}
      >
        <Redo2 aria-hidden="true" />
      </IconButton>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
      <IconButton
        label={t("canvas.action.rotate")}
        disabled={!canRotate}
        onClick={() => {
          useCircuitStore.getState().rotateSelection();
        }}
      >
        <RotateCw aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t("canvas.action.duplicate")}
        disabled={!canDuplicate}
        onClick={() => {
          useCircuitStore.getState().duplicateSelection();
        }}
      >
        <Copy aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t("canvas.action.delete")}
        disabled={!canDelete}
        onClick={() => {
          useCircuitStore.getState().deleteSelection();
        }}
      >
        <Trash2 aria-hidden="true" />
      </IconButton>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
      <IconButton label={t("canvas.action.fitView")} onClick={onFitView}>
        <Maximize aria-hidden="true" />
      </IconButton>
    </div>
  );
}
