import { useState } from "react";

import { t } from "@/i18n/t";
import { useProjectStore } from "@/stores/project-store";

import { renameProject } from "./project-session";

/** Название проекта в верхней панели; щелчок включает переименование. */
export function ProjectName() {
  const phase = useProjectStore((state) => state.phase);
  const name = useProjectStore((state) => state.name);
  const [draft, setDraft] = useState<string | null>(null);

  if (phase === "loading") {
    return <span className="truncate text-muted-foreground">{t("projects.loading")}</span>;
  }
  if (phase !== "ready") {
    return <span className="truncate">{t("workspace.project.untitled")}</span>;
  }
  if (draft !== null) {
    const commit = () => {
      renameProject(draft);
      setDraft(null);
    };
    return (
      <input
        aria-label={t("projects.name.label")}
        className="h-7 w-56 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={draft}
        maxLength={200}
        autoFocus
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="truncate rounded-md px-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={t("projects.name.edit", { name })}
      onClick={() => {
        setDraft(name);
      }}
    >
      {name}
    </button>
  );
}
