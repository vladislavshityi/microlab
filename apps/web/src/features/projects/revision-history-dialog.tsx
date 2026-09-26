import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { getRevision, listRevisions } from "@/api/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { locale, t } from "@/i18n/t";
import { useProjectStore } from "@/stores/project-store";
import { useUiStore } from "@/stores/ui-store";

import { restoreRevision } from "./project-session";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(
    new Date(iso),
  );
}

function countOf(circuit: Record<string, unknown>, key: string): number {
  const value = circuit[key];
  return Array.isArray(value) ? value.length : 0;
}

/** Просмотр кода и состава схемы выбранной версии. */
function RevisionPreview({ projectId, revision }: { projectId: string; revision: number }) {
  const detail = useQuery({
    queryKey: ["projects", projectId, "revisions", revision],
    queryFn: ({ signal }) => getRevision(projectId, revision, signal),
    retry: false,
  });
  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">{t("revisions.loading")}</p>;
  }
  if (detail.isError) {
    return <p role="alert" className="text-sm text-error">{t("revisions.previewError")}</p>;
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {t("revisions.circuitSummary", {
          components: String(countOf(detail.data.circuit, "components")),
          connections: String(countOf(detail.data.circuit, "connections")),
        })}
      </p>
      <pre
        aria-label={t("revisions.codeLabel", { revision: String(revision) })}
        className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs"
      >
        {detail.data.code}
      </pre>
    </div>
  );
}

/** История версий открытого проекта: просмотр и восстановление как новой версии. */
export function RevisionHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const projectId = useProjectStore((state) => state.projectId);
  const current = useProjectStore((state) => state.revision);
  const readOnly = useProjectStore((state) => state.readOnly !== null);
  const showNotice = useUiStore((state) => state.showNotice);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const revisions = useQuery({
    queryKey: ["projects", projectId, "revisions"],
    queryFn: ({ signal }) => listRevisions(projectId ?? "", signal),
    enabled: open && projectId !== null,
    refetchOnMount: "always",
    retry: false,
  });
  const restore = useMutation({
    mutationFn: (revision: number) => restoreRevision(revision),
    onSuccess: (restored) => {
      if (!restored) {
        showNotice("projects.notice.unsavedBlocked");
        return;
      }
      setConfirming(false);
      setSelected(null);
      onOpenChange(false);
      showNotice("revisions.notice.restored");
    },
    onError: () => {
      showNotice("projects.notice.actionFailed");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const active = selected ?? revisions.data?.[0]?.revision ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent closeLabel={t("projects.dialog.close")} className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("revisions.title")}</DialogTitle>
            <DialogDescription>{t("revisions.description")}</DialogDescription>
          </DialogHeader>
          {revisions.isPending && <p className="text-sm text-muted-foreground">{t("revisions.loading")}</p>}
          {revisions.isError && <p role="alert" className="text-sm text-error">{t("revisions.error")}</p>}
          {revisions.data !== undefined && projectId !== null && (
            <div className="grid min-h-0 grid-cols-[12rem_minmax(0,1fr)] gap-3">
              <ul className="max-h-80 overflow-y-auto" aria-label={t("revisions.title")}>
                {revisions.data.map((item) => (
                  <li key={item.revision}>
                    <button
                      type="button"
                      aria-pressed={item.revision === active}
                      className="w-full rounded-md px-2 py-1 text-left hover:bg-accent aria-pressed:bg-accent"
                      onClick={() => {
                        setSelected(item.revision);
                      }}
                    >
                      <span className="block text-sm">
                        {t("revisions.item", { revision: String(item.revision) })}
                        {item.revision === current && ` · ${t("revisions.current")}`}
                      </span>
                      <span className="block text-xs text-muted-foreground">{formatTime(item.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {active !== null && <RevisionPreview projectId={projectId} revision={active} />}
            </div>
          )}
          <DialogFooter>
            {readOnly && <p className="mr-auto text-xs text-muted-foreground">{t("revisions.readOnly")}</p>}
            <Button
              type="button"
              disabled={readOnly || active === null || active === current || restore.isPending}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {t("revisions.restore")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("revisions.confirm.title")}</DialogTitle>
            <DialogDescription>
              {t("revisions.confirm.description", { revision: String(active ?? 0) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t("projects.dialog.cancel")}
            </Button>
            <Button
              type="button"
              disabled={restore.isPending || active === null}
              onClick={() => {
                if (active !== null) restore.mutate(active);
              }}
            >
              {t("revisions.confirm.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
