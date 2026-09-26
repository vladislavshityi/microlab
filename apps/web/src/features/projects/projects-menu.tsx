import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Trash2 } from "lucide-react";
import { useState } from "react";

import { listProjects } from "@/api/projects";
import type { ProjectSummary } from "@/api/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { locale, t } from "@/i18n/t";
import { useProjectStore } from "@/stores/project-store";
import { useUiStore } from "@/stores/ui-store";

import { useProjectActions } from "./use-project-actions";

const PROJECTS_LIST_KEY = ["projects", "list"] as const;

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

interface DeleteTarget {
  id: string;
  name: string;
}

/** Подтверждение удаления проекта. */
function DeleteDialog({ target, onClose }: { target: DeleteTarget | null; onClose: () => void }) {
  const { remove } = useProjectActions();
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("projects.delete.title")}</DialogTitle>
          <DialogDescription>
            {t("projects.delete.description", { name: target?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("projects.dialog.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (target === null) return;
              remove.mutate(target.id, { onSettled: onClose });
            }}
          >
            {t("projects.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectRow({
  project,
  current,
  onOpen,
  onDelete,
}: {
  project: ProjectSummary;
  current: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
      <button
        type="button"
        className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t("projects.list.open", { name: project.name })}
        onClick={onOpen}
      >
        <span className="block truncate text-sm">{project.name}</span>
        <span className="block text-xs text-muted-foreground">
          {t("projects.list.updated", { time: formatTime(project.updatedAt) })}
          {current && ` · ${t("projects.list.current")}`}
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("projects.list.delete", { name: project.name })}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

/** Диалог со списком проектов: открыть или удалить. */
function OpenDialog({
  open,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const currentId = useProjectStore((state) => state.projectId);
  const { open: openProject } = useProjectActions();
  const projects = useQuery({
    queryKey: PROJECTS_LIST_KEY,
    queryFn: ({ signal }) => listProjects(signal),
    enabled: open,
    refetchOnMount: "always",
    retry: false,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("projects.dialog.close")}>
        <DialogHeader>
          <DialogTitle>{t("projects.list.title")}</DialogTitle>
          <DialogDescription>{t("projects.list.description")}</DialogDescription>
        </DialogHeader>
        {projects.isPending && <p className="text-sm text-muted-foreground">{t("projects.list.loading")}</p>}
        {projects.isError && <p role="alert" className="text-sm text-error">{t("projects.list.error")}</p>}
        {projects.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("projects.list.empty")}</p>
        )}
        {projects.data !== undefined && projects.data.length > 0 && (
          <ul className="max-h-80 overflow-y-auto" aria-label={t("projects.list.title")}>
            {projects.data.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                current={project.id === currentId}
                onOpen={() => {
                  openProject.mutate(project.id, {
                    onSuccess: (opened) => {
                      if (opened) onOpenChange(false);
                    },
                  });
                }}
                onDelete={() => {
                  onDelete({ id: project.id, name: project.name });
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Меню проектов в верхней панели: создать, открыть, удалить. */
export function ProjectsMenu() {
  const [openDialog, setOpenDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const phase = useProjectStore((state) => state.phase);
  const projectId = useProjectStore((state) => state.projectId);
  const name = useProjectStore((state) => state.name);
  const { create } = useProjectActions();
  const showNotice = useUiStore((state) => state.showNotice);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label={t("projects.menu.trigger")}>
            <FolderOpen aria-hidden="true" />
            {t("projects.menu.trigger")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => {
              create.mutate(undefined, {
                onSuccess: (created) => {
                  if (!created) showNotice("projects.notice.unsavedBlocked");
                },
              });
            }}
          >
            {t("projects.menu.new")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setOpenDialog(true);
            }}
          >
            {t("projects.menu.open")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={phase !== "ready" || projectId === null}
            onSelect={() => {
              if (projectId !== null) setDeleteTarget({ id: projectId, name });
            }}
          >
            {t("projects.menu.deleteCurrent")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <OpenDialog open={openDialog} onOpenChange={setOpenDialog} onDelete={setDeleteTarget} />
      <DeleteDialog
        target={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
      />
    </>
  );
}
