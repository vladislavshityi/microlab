import { SKETCH_FILE } from "@/features/code-editor/markers";
import { t } from "@/i18n/t";
import { useSimulationStore } from "@/stores/simulation-store";

import { diagnosticLocation, revealDiagnostic } from "./compile-diagnostics";
import { SeverityLabel } from "./problems-panel";

const SEVERITY = { error: "ERROR", warning: "WARNING", note: "INFO" } as const;

/** Диагностики компиляции скетча в «Проблемах»; щелчок — переход к строке в редакторе. */
export function CompileProblems() {
  const diagnostics = useSimulationStore((state) => state.compilation?.diagnostics ?? null);
  if (diagnostics === null || diagnostics.length === 0) return null;
  return (
    <section aria-label={t("problems.compile.label")} className="border-b">
      <h3 className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
        {t("problems.compile.label")}
      </h3>
      <ul className="divide-y">
        {diagnostics.map((diagnostic, index) => {
          const location = diagnosticLocation(diagnostic);
          const navigable = diagnostic.file === SKETCH_FILE && diagnostic.line !== null;
          return (
            <li key={`${location}-${index}`}>
              <button
                type="button"
                disabled={!navigable}
                className="flex w-full items-start gap-3 px-3 py-1.5 text-left text-[13px] enabled:hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                aria-label={navigable ? t("problems.compile.show", { location, message: diagnostic.message }) : undefined}
                onClick={() => {
                  revealDiagnostic(diagnostic);
                }}
              >
                <span className="w-32 pt-px">
                  <SeverityLabel severity={SEVERITY[diagnostic.severity]} />
                </span>
                <span className="min-w-0 flex-1 font-mono text-[12px] break-words">{diagnostic.message}</span>
                {location !== "" && (
                  <span className="max-w-[40%] truncate font-mono text-[11px] text-muted-foreground">{location}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
