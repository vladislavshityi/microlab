import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { useProjectStore, type LoadErrorKind } from "@/stores/project-store";

import { STARTUP_PROJECT_KEY } from "./use-project-bootstrap";
import { useProjectActions } from "./use-project-actions";

const MESSAGE: Record<LoadErrorKind, PlainTranslationKey> = {
  network: "loadError.network",
  invalidDocument: "loadError.invalidDocument",
  unsupportedVersion: "loadError.unsupportedVersion",
  notFound: "loadError.notFound",
  server: "loadError.server",
};

/** Проект не открыт: причина и действия. Рабочий документ в этом состоянии не сохраняется. */
export function LoadErrorBanner() {
  const loadError = useProjectStore((state) => (state.phase === "loadError" ? state.loadError : null));
  const queryClient = useQueryClient();
  const { create } = useProjectActions();
  if (loadError === null) return null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-3 border-b bg-error/10 px-3 py-1.5 text-xs">
      <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-error" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{t("loadError.title")}.</span> {t(MESSAGE[loadError])}
      </span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => {
          useProjectStore.setState({ phase: "loading", loadError: null });
          void queryClient.resetQueries({ queryKey: STARTUP_PROJECT_KEY });
        }}
      >
        {t("loadError.retry")}
      </Button>
      <Button
        type="button"
        size="xs"
        disabled={create.isPending}
        onClick={() => {
          create.mutate();
        }}
      >
        {t("loadError.createNew")}
      </Button>
    </div>
  );
}
