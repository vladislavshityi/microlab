import { locale, t } from "@/i18n/t";
import { PENDING_PHASES, type SimulationPhase } from "@/stores/simulation-store";

/** Какие команды доступны в фазе симуляции. */
export interface ControlAvailability {
  run: boolean;
  pause: boolean;
  resume: boolean;
  stop: boolean;
  reset: boolean;
}

export function controlAvailability(phase: SimulationPhase, projectReady: boolean): ControlAvailability {
  const pending = PENDING_PHASES.has(phase);
  return {
    // Запуск во время работы сессии перезапускает её с текущим кодом и схемой.
    run: projectReady && !pending,
    pause: phase === "running",
    resume: phase === "paused",
    stop: phase === "running" || phase === "paused",
    reset: phase === "running" || phase === "paused",
  };
}

const SECONDS = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Симулированное время в секундах (мкс → «12,345 с»). */
export function formatSimulatedTime(timeUs: number): string {
  return t("simulation.time", { seconds: SECONDS.format(timeUs / 1_000_000) });
}
