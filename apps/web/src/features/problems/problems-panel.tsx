import { CircleAlert, Info, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { CircuitIssue, CircuitValidationResponse } from "@/api/schemas";
import { CircuitValidationError } from "@/api/validation";
import { Button } from "@/components/ui/button";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { useCircuitStore } from "@/stores/circuit-store";
import { useUiStore } from "@/stores/ui-store";

import { issueMessage, issueTargets, type IssueCounts } from "./issue-format";

type Severity = CircuitIssue["severity"];

const SEVERITY: Readonly<Record<Severity, { label: PlainTranslationKey; icon: ReactNode }>> = {
  ERROR: {
    label: "problems.severity.error",
    icon: <CircleAlert aria-hidden="true" className="size-3.5 text-destructive" />,
  },
  WARNING: {
    label: "problems.severity.warning",
    icon: <TriangleAlert aria-hidden="true" className="size-3.5 text-amber-600 dark:text-amber-400" />,
  },
  INFO: {
    label: "problems.severity.info",
    icon: <Info aria-hidden="true" className="size-3.5 text-muted-foreground" />,
  },
};

/** Значок серьёзности с текстом (серьёзность не передаётся только цветом). */
export function SeverityLabel({ severity }: { severity: Severity }) {
  const { label, icon } = SEVERITY[severity];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium">
      {icon}
      {t(label)}
    </span>
  );
}

/** Счётчики замечаний для вкладки: значки с числами и полный текст для чтения с экрана. */
export function ProblemCountsBadge({ counts }: { counts: IssueCounts }) {
  if (counts.errors + counts.warnings + counts.infos === 0) return null;
  const label = t("problems.counts", {
    errors: String(counts.errors),
    warnings: String(counts.warnings),
    infos: String(counts.infos),
  });
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]" aria-label={label} title={label}>
      {counts.errors > 0 && (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          <CircleAlert className="size-3 text-destructive" />
          {counts.errors}
        </span>
      )}
      {counts.warnings > 0 && (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          <TriangleAlert className="size-3 text-amber-600 dark:text-amber-400" />
          {counts.warnings}
        </span>
      )}
      {counts.errors + counts.warnings === 0 && (
        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
          <Info className="size-3" />
          {counts.infos}
        </span>
      )}
    </span>
  );
}

function selectIssue(issue: CircuitIssue, nets: CircuitValidationResponse["nets"]) {
  const store = useCircuitStore.getState();
  const targets = issueTargets(issue, nets, {
    boardId: store.board.id,
    component: (id) => id === store.board.id || id in store.components,
    connection: (id) => id in store.connections,
    wires: store.connectionOrder.flatMap((id) => {
      const wire = store.connections[id];
      return wire === undefined
        ? []
        : [{ id, from: `${wire.from.componentId}.${wire.from.pinId}`, to: `${wire.to.componentId}.${wire.to.pinId}` }];
    }),
  });
  if (targets.componentIds.length === 0 && targets.connectionIds.length === 0) return;
  store.select(targets);
  useUiStore.getState().focusCanvasOn(targets.componentIds);
}

function refSummary(issue: CircuitIssue): string {
  return issue.refs
    .filter((ref) => ref.kind !== "net" && ref.kind !== "field")
    .map((ref) => ref.id)
    .join(", ");
}

interface ProblemsPanelProps {
  data: CircuitValidationResponse | undefined;
  error: Error | null;
  isFetching: boolean;
  onRetry: () => void;
}

/** Список замечаний проверки схемы; щелчок выделяет объекты на холсте. */
export function ProblemsPanel({ data, error, isFetching, onRetry }: ProblemsPanelProps) {
  if (data === undefined) {
    if (error !== null) {
      const unreachable = error instanceof CircuitValidationError && error.kind === "unreachable";
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground" role="status">
          {t(unreachable ? "problems.unreachable" : "problems.unexpected")}
          <Button size="xs" variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden="true" />
            {t("problems.retry")}
          </Button>
        </div>
      );
    }
    return (
      <p className="flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground" role="status">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        {t("problems.checking")}
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      <p className="sr-only" role="status">
        {isFetching ? t("problems.stale") : ""}
      </p>
      {error !== null && (
        <p className="px-3 pt-2 text-[12px] text-muted-foreground">
          {t(error instanceof CircuitValidationError && error.kind === "unreachable" ? "problems.unreachable" : "problems.unexpected")}
        </p>
      )}
      {data.issues.length === 0 ? (
        <p className="px-3 py-2 text-[13px] text-muted-foreground">{t("problems.empty")}</p>
      ) : (
        <ul aria-label={t("problems.label")} className={cn("divide-y", isFetching && "opacity-70")}>
          {data.issues.map((issue, index) => {
            const message = issueMessage(issue);
            const refs = refSummary(issue);
            return (
              <li key={`${issue.code}-${index}`}>
                <button
                  type="button"
                  className="flex w-full items-start gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  aria-label={t("problems.show", { message })}
                  onClick={() => {
                    selectIssue(issue, data.nets);
                  }}
                >
                  <span className="w-32 pt-px">
                    <SeverityLabel severity={issue.severity} />
                  </span>
                  <span className="min-w-0 flex-1">{message}</span>
                  {refs !== "" && (
                    <span className="max-w-[40%] truncate font-mono text-[11px] text-muted-foreground">{refs}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-3 py-2 text-[11px] text-muted-foreground">{t("problems.disclaimer")}</p>
    </div>
  );
}
