import type { ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, t } from "@/i18n/t";
import { cn } from "@/lib/utils";

import { toHealthView, type HealthView, type StatusTone } from "./health-view";
import { StatusBadge } from "./status-badge";
import { TONE_ICON } from "./status-icons";
import { useDelayedFlag } from "./use-delayed-flag";
import { useHealth } from "./use-health";

const timeFormatter = new Intl.DateTimeFormat(locale, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
  unknown: "text-muted-foreground",
};

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="flex items-center">{children}</dd>
    </div>
  );
}

function StatusRowsSkeleton() {
  return (
    <>
      <span className="sr-only">{t("health.a11y.loading")}</span>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="flex min-h-8 items-center justify-between gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </>
  );
}

function StatusRows({ view }: { view: HealthView }) {
  return (
    <>
      <StatusRow label={t("health.check.backend")}>
        <StatusBadge cell={view.backend} />
      </StatusRow>
      <StatusRow label={t("health.check.database")}>
        <StatusBadge cell={view.database} />
      </StatusRow>
      <StatusRow label={t("health.check.version")}>
        <span className="font-mono text-xs">{view.version ?? t("health.version.unknown")}</span>
      </StatusRow>
    </>
  );
}

/**
 * Индикатор состояния backend и БД в строке состояния. Кнопка показывает итог
 * (иконка + текст, не только цвет), всплывающая панель — подробности и повтор проверки.
 */
export function SystemStatusIndicator() {
  const query = useHealth();
  const isChecking = query.isFetching;
  const showSpinner = useDelayedFlag(isChecking);

  // fetchHealth превращает сетевые и HTTP-ошибки в состояния; ошибка самого query означала
  // бы баг клиента и показывается как «неожиданный ответ», а не роняет интерфейс.
  const view: HealthView | null = query.data
    ? toHealthView(query.data)
    : query.isError
      ? toHealthView({ kind: "unexpected", httpStatus: null, code: null, requestId: null })
      : null;

  const checkedAt = query.data ? query.dataUpdatedAt : query.isError ? query.errorUpdatedAt : 0;

  const handleRetry = () => {
    if (isChecking) {
      return;
    }
    void query.refetch();
  };

  const Icon = view === null ? LoaderCircle : TONE_ICON[view.summary.tone];

  return (
    <Popover>
      {/* Живой регион объявляет только смену итогового состояния. */}
      <div role="status" aria-live="polite" className="flex">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-xs font-normal"
            aria-describedby="system-status-trigger-hint"
          >
            <Icon
              aria-hidden="true"
              className={cn(
                view === null ? "animate-spin text-muted-foreground" : TONE_TEXT[view.summary.tone],
              )}
            />
            {view === null ? t("health.action.checking") : t(view.summary.title)}
          </Button>
        </PopoverTrigger>
        <span id="system-status-trigger-hint" className="sr-only">
          {t("health.indicator.details")}
        </span>
      </div>
      <PopoverContent align="start" side="top" className="w-80 p-3">
        <h2 className="text-sm font-medium">{t("health.page.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {view === null ? t("health.page.description") : t(view.summary.description)}
        </p>
        <dl className="mt-2" aria-busy={isChecking}>
          {view === null ? <StatusRowsSkeleton /> : <StatusRows view={view} />}
        </dl>
        {view !== null && view.details.length > 0 && (
          <ul className="mt-2 font-mono text-xs text-muted-foreground select-text">
            {view.details.map((detail) => (
              <li key={detail.key}>{detail.text}</li>
            ))}
          </ul>
        )}
        {view !== null && (
          <div className="mt-3 flex items-center justify-between gap-4 border-t pt-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {checkedAt > 0 &&
                t("health.meta.lastChecked", { time: timeFormatter.format(checkedAt) })}
            </span>
            <Button
              type="button"
              size="sm"
              variant={view.retryIsPrimary ? "default" : "outline"}
              aria-disabled={isChecking || undefined}
              onClick={handleRetry}
            >
              {showSpinner ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {showSpinner ? t("health.action.checking") : t("health.action.retry")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
