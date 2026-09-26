import { AlertTriangle, Check, CircleDot, Loader2, Save, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { useProjectStore, type SaveErrorKind, type SaveStatus } from "@/stores/project-store";

import { saveNow } from "./project-session";

const STATUS: Record<SaveStatus, { label: PlainTranslationKey; icon: LucideIcon; tone: string }> = {
  saved: { label: "save.status.saved", icon: Check, tone: "text-muted-foreground" },
  saving: { label: "save.status.saving", icon: Loader2, tone: "text-muted-foreground" },
  dirty: { label: "save.status.dirty", icon: CircleDot, tone: "text-warning" },
  error: { label: "save.status.error", icon: AlertTriangle, tone: "text-error" },
  conflict: { label: "save.status.conflict", icon: AlertTriangle, tone: "text-error" },
};

const ERROR_HINT: Record<SaveErrorKind, PlainTranslationKey> = {
  network: "save.error.network",
  invalid: "save.error.invalid",
  server: "save.error.server",
};

/** Состояние сохранения (значок и текст) и кнопка «Сохранить». */
export function SaveStatusControl() {
  const phase = useProjectStore((state) => state.phase);
  const status = useProjectStore((state) => state.status);
  const errorKind = useProjectStore((state) => state.errorKind);
  if (phase !== "ready") return null;
  const { label, icon: Icon, tone } = STATUS[status];
  const hint = status === "error" && errorKind !== null ? t(ERROR_HINT[errorKind]) : undefined;
  return (
    <div className="flex items-center gap-1">
      <span
        role="status"
        aria-live="polite"
        title={hint}
        className={cn("flex items-center gap-1.5 text-xs", tone)}
        data-save-status={status}
      >
        <Icon aria-hidden="true" className={cn("size-3.5", status === "saving" && "animate-spin")} />
        {t(label)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("save.button")}
        title={t("save.button")}
        disabled={status === "conflict"}
        onClick={() => {
          void saveNow();
        }}
      >
        <Save aria-hidden="true" />
      </Button>
    </div>
  );
}
