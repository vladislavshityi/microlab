import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { ComponentInstance } from "@microlab/circuit-schema";

import { playTone, stopTone } from "@/features/simulation/buzzer-audio";
import { setPotentiometerPosition } from "@/features/simulation/simulation-actions";
import { formatQuantityText } from "@/features/circuit-model/quantity";
import { locale, t } from "@/i18n/t";
import { ACTIVE_PHASES, useSimulationStore, type LedChannelState } from "@/stores/simulation-store";
import { useUiStore } from "@/stores/ui-store";

import {
  PIEZO_BODY,
  POT_TRACK,
  potWiperX,
  RGB_BODY,
  SEGMENT_DP,
  SEGMENT_LINES,
  SEGMENT_WIDTH,
  SERVO_SHAFT,
  definitionX,
  servoHornEnd,
} from "./component-geometry";
import { LED_FILL } from "./led-colors";
import { OverlayFrame, type FrameProps } from "./overlay-frame";

/**
 * Слои симуляции дополнительных компонентов. Как и у светодиода, каждый слой подписан только
 * на состояние своего компонента в simulationStore.
 */

/** Минимальная заметная яркость открытого канала (очень малый ток). */
const MIN_VISIBLE = 0.15;
/** Шаг движка потенциометра с клавиатуры. */
const POT_KEY_STEP = 0.05;

function channelLevel(channel: LedChannelState | undefined): number {
  if (channel?.on !== true) return 0;
  return Math.max(channel.brightness, MIN_VISIBLE);
}

function numberProperty(properties: ComponentInstance["properties"] | undefined, id: string, fallback: number): number {
  const value = properties?.[id];
  return typeof value === "number" ? value : fallback;
}

/** RGB-светодиод: смешанный цвет по токам каналов; 7-сегментный индикатор: светящиеся сегменты. */
export const LedArrayLight = memo(function LedArrayLight({
  componentId,
  properties,
  ...frame
}: FrameProps & { componentId: string; properties: ComponentInstance["properties"] | undefined }) {
  const channels = useSimulationStore((state) => state.components[componentId]?.channels);
  if (channels === undefined) return null;
  if (frame.definition.type === "rgb-led") {
    const r = channelLevel(channels["r"]);
    const g = channelLevel(channels["g"]);
    const b = channelLevel(channels["b"]);
    const peak = Math.max(r, g, b);
    if (peak === 0) return null;
    // Цвет — отношение каналов, яркость — прозрачность (визуализация, не колориметрия).
    const rgb = [r, g, b].map((c) => Math.round((255 * c) / peak)).join(", ");
    return (
      <OverlayFrame {...frame}>
        <circle
          cx={RGB_BODY.cx}
          cy={RGB_BODY.cy}
          r={RGB_BODY.r * 0.92}
          fill={`rgb(${rgb})`}
          opacity={0.35 + 0.65 * Math.min(1, peak)}
          data-testid={`rgb-light-${componentId}`}
          data-rgb={rgb}
        />
      </OverlayFrame>
    );
  }
  const color = properties?.["color"];
  const fill = (typeof color === "string" ? LED_FILL[color] : undefined) ?? LED_FILL["red"] ?? "red";
  const lit = Object.keys(SEGMENT_LINES).filter((id) => channelLevel(channels[id]) > 0);
  const dp = channelLevel(channels["dp"]);
  return (
    <OverlayFrame {...frame}>
      <g data-testid={`segments-${componentId}`} data-lit={[...lit, ...(dp > 0 ? ["dp"] : [])].join("")}>
        {lit.map((id) => {
          const line = SEGMENT_LINES[id];
          if (line === undefined) return null;
          const [x1, y1, x2, y2] = line;
          return (
            <line
              key={id}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={fill}
              strokeWidth={SEGMENT_WIDTH}
              strokeLinecap="round"
              opacity={0.45 + 0.55 * channelLevel(channels[id])}
            />
          );
        })}
        {dp > 0 && <circle cx={SEGMENT_DP.cx} cy={SEGMENT_DP.cy} r={SEGMENT_DP.r} fill={fill} opacity={0.45 + 0.55 * dp} />}
      </g>
    </OverlayFrame>
  );
});

/**
 * Движок потенциометра. Вне симуляции показывает положение из свойств; во время симуляции —
 * текущее положение, которое можно менять перетаскиванием по корпусу или стрелками.
 */
export const PotentiometerControl = memo(function PotentiometerControl({
  componentId,
  properties,
  ...frame
}: FrameProps & { componentId: string; properties: ComponentInstance["properties"] | undefined }) {
  const active = useSimulationStore((state) => ACTIVE_PHASES.has(state.phase));
  const runtime = useSimulationStore((state) => state.components[componentId]?.position);
  const dragging = useRef(false);
  const initial = numberProperty(properties, "positionPercent", 50) / 100;
  const position = active && runtime !== undefined ? runtime : initial;
  const x = potWiperX(position);
  const { width } = frame.definition.visual;

  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const local = definitionX(frame.rotation, width, rect, event.clientX, event.clientY);
    const next = (local - POT_TRACK.x0) / (POT_TRACK.x1 - POT_TRACK.x0);
    void setPotentiometerPosition(componentId, Math.min(1, Math.max(0, next)));
  };

  return (
    <>
      <OverlayFrame {...frame}>
        <g data-testid={`pot-wiper-${componentId}`} data-position={position.toFixed(3)}>
          <path
            d={`M2 0 L2 0.7 L${x} 0.7 L${x} 1.45`}
            fill="none"
            stroke={active ? "var(--ring)" : "var(--foreground)"}
            strokeWidth={0.1}
            strokeLinejoin="round"
          />
          <path d={`M${x - 0.18} 1.3 L${x} 1.6 L${x + 0.18} 1.3 Z`} fill={active ? "var(--ring)" : "var(--foreground)"} />
        </g>
      </OverlayFrame>
      {active && (
        <div
          role="slider"
          tabIndex={0}
          aria-label={t("canvas.potentiometer.control", { component: componentId })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position * 100)}
          aria-valuetext={`${Math.round(position * 100)} %`}
          data-testid={`pot-control-${componentId}`}
          className="nodrag nopan nokey absolute inset-0 cursor-ew-resize rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.stopPropagation();
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            moveTo(event);
          }}
          onPointerMove={(event) => {
            if (dragging.current) moveTo(event);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={(event: KeyboardEvent) => {
            const delta = { ArrowRight: POT_KEY_STEP, ArrowUp: POT_KEY_STEP, ArrowLeft: -POT_KEY_STEP, ArrowDown: -POT_KEY_STEP }[
              event.key
            ];
            if (delta === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            void setPotentiometerPosition(componentId, Math.min(1, Math.max(0, position + delta)));
          }}
        />
      )}
    </>
  );
});

/** Фоторезистор: текущая освещённость во время симуляции. */
export const LdrLabel = memo(function LdrLabel({ componentId, ...frame }: FrameProps & { componentId: string }) {
  const lux = useSimulationStore((state) =>
    ACTIVE_PHASES.has(state.phase) ? state.components[componentId]?.illuminanceLux : undefined,
  );
  if (lux === undefined) return null;
  return (
    <OverlayFrame {...frame}>
      <text x={3.2} y={0.35} fontSize={0.38} fill="var(--ring)" fontFamily="var(--font-code)" data-testid={`ldr-lux-${componentId}`}>
        {formatQuantityText(lux, "lux", locale)}
      </text>
    </OverlayFrame>
  );
});

/** Пьезоизлучатель: индикатор звука и частота; при включённом звуке — тон в браузере. */
export const PiezoIndicator = memo(function PiezoIndicator({ componentId, ...frame }: FrameProps & { componentId: string }) {
  const running = useSimulationStore((state) => state.phase === "running");
  const active = useSimulationStore((state) => state.components[componentId]?.active === true);
  const frequency = useSimulationStore((state) => state.components[componentId]?.frequencyHz ?? 0);
  const sound = useUiStore((state) => state.buzzerSound);
  const audible = running && active && sound;

  useEffect(() => {
    if (audible) playTone(componentId, frequency);
    else stopTone(componentId);
  }, [audible, componentId, frequency]);
  useEffect(
    () => () => {
      stopTone(componentId);
    },
    [componentId],
  );

  if (!active) return null;
  const { cx, cy, r } = PIEZO_BODY;
  return (
    <OverlayFrame {...frame}>
      <g data-testid={`piezo-${componentId}`} data-frequency={frequency.toFixed(2)}>
        <circle cx={cx} cy={cy} r={0.25} fill="var(--ring)" />
        {[0.45, 0.7].map((k) => (
          <path
            key={k}
            d={`M${cx + r + k * 0.6} ${cy - k} A ${k * 1.4} ${k * 1.4} 0 0 1 ${cx + r + k * 0.6} ${cy + k}`}
            fill="none"
            stroke="var(--ring)"
            strokeWidth={0.08}
            strokeLinecap="round"
          />
        ))}
        <text x={cx} y={cy - r - 0.15} fontSize={0.4} textAnchor="middle" fill="var(--ring)" fontFamily="var(--font-code)">
          {t("canvas.piezo.frequency", { value: frequency.toFixed(1) })}
        </text>
      </g>
    </OverlayFrame>
  );
});

/** Качалка сервопривода: угол из симуляции; без импульсов или вне симуляции — 90°, приглушённо. */
export const ServoHorn = memo(function ServoHorn({ componentId, ...frame }: FrameProps & { componentId: string }) {
  const angle = useSimulationStore((state) => state.components[componentId]?.angle);
  const powered = useSimulationStore((state) => state.components[componentId]?.powered);
  const live = typeof angle === "number";
  const end = servoHornEnd(live ? angle : 90);
  const color = live && powered !== false ? "var(--ring)" : "var(--muted-foreground)";
  return (
    <OverlayFrame {...frame}>
      <g data-testid={`servo-horn-${componentId}`} data-angle={live ? angle.toFixed(1) : ""}>
        <line
          x1={SERVO_SHAFT.cx}
          y1={SERVO_SHAFT.cy}
          x2={end.x}
          y2={end.y}
          stroke={color}
          strokeWidth={0.3}
          strokeLinecap="round"
          strokeOpacity={live ? 1 : 0.5}
        />
        <circle cx={SERVO_SHAFT.cx} cy={SERVO_SHAFT.cy} r={SERVO_SHAFT.r} fill="var(--card)" stroke="var(--foreground)" strokeWidth={0.1} />
        {live && (
          <text x={SERVO_SHAFT.cx} y={3.45} fontSize={0.4} textAnchor="middle" fill={color} fontFamily="var(--font-code)">
            {t("canvas.servo.angle", { value: angle.toFixed(0) })}
          </text>
        )}
        {powered === false && (
          <text x={SERVO_SHAFT.cx} y={0.75} fontSize={0.36} textAnchor="middle" fill="var(--muted-foreground)">
            {t("canvas.servo.noPower")}
          </text>
        )}
      </g>
    </OverlayFrame>
  );
});
