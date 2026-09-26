import { useId } from "react";
import type { ComponentDefinition, ComponentInstance, NumberPropertyDefinition } from "@microlab/circuit-schema";

import { formatQuantityText } from "@/features/circuit-model/quantity";
import { resumeAudio } from "@/features/simulation/buzzer-audio";
import { setIlluminance, setPotentiometerPosition } from "@/features/simulation/simulation-actions";
import { locale, t } from "@/i18n/t";
import { ACTIVE_PHASES, useSimulationStore } from "@/stores/simulation-store";
import { useUiStore } from "@/stores/ui-store";

/**
 * Входы и состояние компонента во время симуляции: движок потенциометра, освещённость
 * фоторезистора, частота пьезоизлучателя и угол сервопривода. Значения входов не
 * сохраняются в проект — начальные значения задаются параметрами компонента.
 */

const SLIDER_CLASS = "w-full accent-[var(--ring)]";

function numberDefault(definition: ComponentDefinition, id: string): NumberPropertyDefinition | undefined {
  return definition.properties.find((p): p is NumberPropertyDefinition => p.type === "number" && p.id === id);
}

function initial(definition: ComponentDefinition, properties: ComponentInstance["properties"], id: string): number {
  const value = properties[id];
  return typeof value === "number" ? value : (numberDefault(definition, id)?.default ?? 0);
}

function Note({ children }: { children: string }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

function PositionInput({ id, start }: { id: string; start: number }) {
  const inputId = useId();
  const active = useSimulationStore((state) => ACTIVE_PHASES.has(state.phase));
  const runtime = useSimulationStore((state) => state.components[id]?.position);
  const position = active && runtime !== undefined ? runtime : start;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="flex justify-between text-xs text-muted-foreground">
        <span>{t("properties.sim.position")}</span>
        <span className="font-mono">{Math.round(position * 100)} %</span>
      </label>
      <input
        id={inputId}
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(position * 100)}
        disabled={!active}
        className={SLIDER_CLASS}
        onChange={(event) => {
          void setPotentiometerPosition(id, Number(event.target.value) / 100);
        }}
      />
      <Note>{active ? t("properties.sim.inputNote") : t("properties.sim.inactive")}</Note>
    </div>
  );
}

/** Логарифмическая шкала освещённости: 10^x лк. */
function IlluminanceInput({ id, start, min, max }: { id: string; start: number; min: number; max: number }) {
  const inputId = useId();
  const active = useSimulationStore((state) => ACTIVE_PHASES.has(state.phase));
  const runtime = useSimulationStore((state) => state.components[id]?.illuminanceLux);
  const lux = active && runtime !== undefined ? runtime : start;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="flex justify-between text-xs text-muted-foreground">
        <span>{t("properties.sim.illuminance")}</span>
        <span className="font-mono">{formatQuantityText(lux, "lux", locale)}</span>
      </label>
      <input
        id={inputId}
        type="range"
        min={Math.log10(min)}
        max={Math.log10(max)}
        step={0.05}
        value={Math.log10(lux)}
        disabled={!active}
        aria-valuetext={formatQuantityText(lux, "lux", locale)}
        className={SLIDER_CLASS}
        onChange={(event) => {
          const value = Number((10 ** Number(event.target.value)).toPrecision(3));
          void setIlluminance(id, Math.min(max, Math.max(min, value)));
        }}
      />
      <Note>{active ? t("properties.sim.inputNote") : t("properties.sim.inactive")}</Note>
    </div>
  );
}

function PiezoState({ id }: { id: string }) {
  const inputId = useId();
  const active = useSimulationStore((state) => state.components[id]?.active === true);
  const frequency = useSimulationStore((state) => state.components[id]?.frequencyHz ?? 0);
  const sound = useUiStore((state) => state.buzzerSound);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{t("properties.sim.frequency")}</span>
        <span className="font-mono">{active ? t("canvas.piezo.frequency", { value: frequency.toFixed(1) }) : t("properties.sim.silent")}</span>
      </div>
      <label htmlFor={inputId} className="flex items-center gap-2 text-xs">
        <input
          id={inputId}
          type="checkbox"
          checked={sound}
          onChange={(event) => {
            if (event.target.checked) resumeAudio();
            useUiStore.getState().setBuzzerSound(event.target.checked);
          }}
        />
        {t("properties.sim.sound")}
      </label>
      <Note>{t("properties.sim.soundNote")}</Note>
    </div>
  );
}

function ServoState({ id }: { id: string }) {
  const angle = useSimulationStore((state) => state.components[id]?.angle);
  const powered = useSimulationStore((state) => state.components[id]?.powered);
  let text: string = t("properties.sim.noPulses");
  if (powered === false) text = t("properties.sim.noPower");
  else if (typeof angle === "number") text = t("canvas.servo.angle", { value: angle.toFixed(1) });
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{t("properties.sim.angle")}</span>
      <span className="font-mono">{text}</span>
    </div>
  );
}

/** Секция «Во время симуляции» для компонентов с входами или наблюдаемым состоянием; иначе null. */
export function SimulationInputs({
  id,
  definition,
  properties,
}: {
  id: string;
  definition: ComponentDefinition;
  properties: ComponentInstance["properties"];
}) {
  switch (definition.type) {
    case "potentiometer":
      return <PositionInput id={id} start={initial(definition, properties, "positionPercent") / 100} />;
    case "photoresistor": {
      const property = numberDefault(definition, "illuminanceLux");
      return (
        <IlluminanceInput
          id={id}
          start={initial(definition, properties, "illuminanceLux")}
          min={property?.minimum ?? 0.1}
          max={property?.maximum ?? 100_000}
        />
      );
    }
    case "piezo-buzzer":
      return <PiezoState id={id} />;
    case "servo":
      return <ServoState id={id} />;
    default:
      return null;
  }
}
