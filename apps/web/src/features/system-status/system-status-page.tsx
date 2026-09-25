import { useEffect, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, t } from "@/i18n/t";

import { toHealthView, type HealthView } from "./health-view";
import { StatusBadge } from "./status-badge";
import { TONE_ICON } from "./status-icons";
import { useDelayedFlag } from "./use-delayed-flag";
import { useHealth } from "./use-health";

const timeFormatter = new Intl.DateTimeFormat(locale, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function Summary({ view }: { view: HealthView }) {
  const Icon = TONE_ICON[view.summary.tone];
  return (
    <Alert variant={view.summary.tone}>
      <Icon aria-hidden="true" />
      <AlertTitle>{t(view.summary.title)}</AlertTitle>
      <AlertDescription>
        <p>{t(view.summary.description)}</p>
        {view.details.length > 0 && (
          // Детали меняются при каждом запросе (request id). aria-live="off" не даёт окружающему
          // status region зачитывать их заново; объявляются только смены состояния.
          <ul aria-live="off" className="font-mono text-xs text-muted-foreground select-text">
            {view.details.map((detail) => (
              <li key={detail.key}>{detail.text}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-center">{children}</dd>
    </div>
  );
}

function StatusRowsSkeleton() {
  return (
    <>
      <span className="sr-only">{t("health.a11y.loading")}</span>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="flex min-h-9 items-center justify-between gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </>
  );
}

export function SystemStatusPage() {
  const query = useHealth();

  useEffect(() => {
    document.title = t("app.documentTitle", { page: t("health.page.title") });
  }, []);

  const isChecking = query.isFetching;
  const showSpinner = useDelayedFlag(isChecking);

  // fetchHealth превращает любую сетевую/HTTP-ошибку в состояние, поэтому ошибка query здесь
  // означала бы непредвиденный баг клиента; она показывается как "unexpected", а не роняет
  // страницу.
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

  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-12 pb-12">
      <h1 className="text-xl font-semibold">{t("health.page.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("health.page.description")}</p>

      {/* Постоянный live region: объявляется только при смене содержимого (другое состояние). */}
      <div role="status" aria-live="polite" className="mt-6">
        {view && <Summary key={view.summary.title} view={view} />}
      </div>

      <Card className="mt-4" aria-busy={isChecking}>
        <CardContent>
          <dl>
            {view === null ? (
              <StatusRowsSkeleton />
            ) : (
              <>
                <StatusRow label={t("health.check.backend")}>
                  <StatusBadge cell={view.backend} />
                </StatusRow>
                <StatusRow label={t("health.check.database")}>
                  <StatusBadge cell={view.database} />
                </StatusRow>
                <StatusRow label={t("health.check.version")}>
                  <span className="font-mono text-xs">
                    {view.version ?? t("health.version.unknown")}
                  </span>
                </StatusRow>
              </>
            )}
          </dl>
        </CardContent>
        {view !== null && (
          <CardFooter className="justify-between gap-4 border-t">
            <span className="text-xs text-muted-foreground tabular-nums">
              {checkedAt > 0 &&
                t("health.meta.lastChecked", { time: timeFormatter.format(checkedAt) })}
            </span>
            <Button
              type="button"
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
          </CardFooter>
        )}
      </Card>
    </main>
  );
}
