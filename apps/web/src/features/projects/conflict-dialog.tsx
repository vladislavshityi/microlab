import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n/t";
import { useProjectStore } from "@/stores/project-store";

import { useProjectActions } from "./use-project-actions";

/**
 * Конфликт сохранения: проект изменён или удалён в другом месте. Автосохранение
 * остановлено; пользователь выбирает, что делать с локальной версией. Закрыть диалог без
 * выбора нельзя — иначе изменения остались бы несохранёнными незаметно.
 */
export function ConflictDialog() {
  const conflict = useProjectStore((state) => (state.status === "conflict" ? state.conflict : null));
  const { reload, saveCopy } = useProjectActions();
  const busy = reload.isPending || saveCopy.isPending;
  return (
    <Dialog open={conflict !== null}>
      <DialogContent
        onEscapeKeyDown={(event) => {
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {conflict === "deleted" ? t("conflict.deleted.title") : t("conflict.revision.title")}
          </DialogTitle>
          <DialogDescription>
            {conflict === "deleted"
              ? t("conflict.deleted.description")
              : t("conflict.revision.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:flex-col sm:items-stretch">
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              saveCopy.mutate();
            }}
          >
            {t("conflict.saveCopy")}
          </Button>
          {conflict === "revision" && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                reload.mutate();
              }}
            >
              {t("conflict.reload")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
