import type { ReactNode } from "react";
import { Loader2, Pause, Play, RotateCcw, Square, StepForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";
import { PENDING_PHASES, useSimulationStore, type SimulationPhase } from "@/stores/simulation-store";

import { controlAvailability, formatSimulatedTime } from "./controls";

import { controlSimulation, runSimulation } from "./simulation-actions";

const PHASE_LABEL: Readonly<Record<SimulationPhase, PlainTranslationKey>> = {
  idle: "simulation.phase.idle",
  validating: "simulation.phase.validating",
  compiling: "simulation.phase.compiling",
  starting: "simulation.phase.starting",
  running: "simulation.phase.running",
  paused: "simulation.phase.paused",
  stopped: "simulation.phase.stopped",
  error: "simulation.phase.error",
};

function ControlButton({
  label,
  disabled,
  onClick,
  children,
  primary = false,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* span: подсказка видна и у неактивной кнопки. */}
        <span className="inline-flex">
          <Button
            type="button"
            variant={primary ? "default" : "ghost"}
            size={primary ? "xs" : "icon-sm"}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn(primary && "h-7 px-2.5")}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Симулированное время: отдельный компонент, чтобы частые обновления не перерисовывали кнопки. */
function SimulatedTime() {
  const timeUs = useSimulationStore((state) => state.timeUs);
  const visible = useSimulationStore((state) => state.simulationId !== null);
  if (!visible) return null;
  return (
    <span className="w-24 text-right font-mono text-xs text-muted-foreground tabular-nums" data-testid="simulated-time">
      {formatSimulatedTime(timeUs)}
    </span>
  );
}

/** Кнопки запуска и управления симуляцией и её состояние. */
export function SimulationControls() {
  const phase = useSimulationStore((state) => state.phase);
  const projectReady = useProjectStore((state) => state.phase === "ready");
  const available = controlAvailability(phase, projectReady);
  const pending = PENDING_PHASES.has(phase);
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t("simulation.controls")}>
      <ControlButton
        primary
        label={t("simulation.run")}
        disabled={!available.run}
        onClick={() => {
          void runSimulation();
        }}
      >
        {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Play aria-hidden="true" />}
        <span>{t("simulation.runShort")}</span>
      </ControlButton>
      {phase === "paused" ? (
        <ControlButton
          label={t("simulation.resume")}
          disabled={!available.resume}
          onClick={() => {
            void controlSimulation("resume");
          }}
        >
          <StepForward aria-hidden="true" />
        </ControlButton>
      ) : (
        <ControlButton
          label={t("simulation.pause")}
          disabled={!available.pause}
          onClick={() => {
            void controlSimulation("pause");
          }}
        >
          <Pause aria-hidden="true" />
        </ControlButton>
      )}
      <ControlButton
        label={t("simulation.stop")}
        disabled={!available.stop}
        onClick={() => {
          void controlSimulation("stop");
        }}
      >
        <Square aria-hidden="true" />
      </ControlButton>
      <ControlButton
        label={t("simulation.reset")}
        disabled={!available.reset}
        onClick={() => {
          void controlSimulation("reset");
        }}
      >
        <RotateCcw aria-hidden="true" />
      </ControlButton>
      <span
        role="status"
        aria-live="polite"
        data-simulation-phase={phase}
        className={cn(
          "ml-1 text-xs",
          phase === "error" ? "text-error" : phase === "running" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {t(PHASE_LABEL[phase])}
      </span>
      <SimulatedTime />
    </div>
  );
}
