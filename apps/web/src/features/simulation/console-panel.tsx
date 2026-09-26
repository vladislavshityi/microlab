import { useEffect, useRef } from "react";
import { CircleAlert, Info, Trash2, TriangleAlert } from "lucide-react";

import { IconButton } from "@/features/workspace/icon-button";
import { t, translateWith } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { RUNTIME_ISSUE_KEYS, useSimulationStore, type ConsoleEntry } from "@/stores/simulation-store";

import { formatSimulatedTime } from "./controls";

function LevelIcon({ level }: { level: ConsoleEntry["level"] }) {
  if (level === "error") return <CircleAlert aria-label={t("problems.severity.error")} className="size-3.5 shrink-0 text-destructive" />;
  if (level === "warning") {
    return <TriangleAlert aria-label={t("problems.severity.warning")} className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />;
  }
  return <Info aria-label={t("problems.severity.info")} className="size-3.5 shrink-0 text-muted-foreground" />;
}

/** Текст строки консоли; замечания симулятора с известным кодом — на языке UI. */
function entryText(entry: Extract<ConsoleEntry, { kind: "message" }>): string {
  if (entry.key === "console.sim.issue") {
    const code = entry.params["code"] ?? "";
    const known = RUNTIME_ISSUE_KEYS[code];
    if (known !== undefined) {
      return translateWith("console.sim.issueKnown", {
        code,
        text: translateWith(known, { subject: entry.params["subject"] ?? "—" }),
      });
    }
  }
  return translateWith(entry.key, entry.params);
}

/** Вкладка «Консоль»: этапы запуска, вывод компилятора и события симуляции. */
export function ConsolePanel() {
  const entries = useSimulationStore((state) => state.console);
  const clear = useSimulationStore((state) => state.clearConsole);
  const endRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center justify-end border-b px-1">
        <IconButton label={t("console.clear")} disabled={entries.length === 0} onClick={clear}>
          <Trash2 aria-hidden="true" />
        </IconButton>
      </div>
      {entries.length === 0 ? (
        <p className="px-3 py-2 font-mono text-[13px] text-muted-foreground">{t("console.empty")}</p>
      ) : (
        <ul aria-label={t("console.label")} className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px]">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2 px-3 py-0.5">
              <span className="pt-0.5">
                <LevelIcon level={entry.level} />
              </span>
              {entry.timeUs !== null && (
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatSimulatedTime(entry.timeUs)}</span>
              )}
              {entry.kind === "output" ? (
                <pre className="min-w-0 flex-1 whitespace-pre-wrap text-muted-foreground">{entry.text}</pre>
              ) : (
                <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", entry.level === "error" && "text-destructive")}>
                  {entryText(entry)}
                </span>
              )}
            </li>
          ))}
          <li ref={endRef} aria-hidden="true" />
        </ul>
      )}
    </div>
  );
}
