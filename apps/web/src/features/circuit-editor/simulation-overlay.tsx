import { memo, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { ComponentDefinition, ComponentInstance, Rotation } from "@microlab/circuit-schema";

import { GRID_PX } from "@/features/circuit-model/geometry";
import { setButtonPressed } from "@/features/simulation/simulation-actions";
import { t } from "@/i18n/t";
import { ACTIVE_PHASES, builtinLedLevel, useSimulationStore } from "@/stores/simulation-store";

import { LED_FILL } from "./led-colors";
import { rotationTransform } from "./rotation";

/**
 * Состояние симуляции поверх символа компонента. Каждый слой подписан только на своё
 * состояние в simulationStore, поэтому события симуляции не перерисовывают узел целиком.
 * Свечение передаётся только прозрачностью и цветом (без фильтров размытия), чтобы
 * символ оставался чётким при любом масштабе.
 */

interface OverlayFrameProps {
  definition: ComponentDefinition;
  rotation: Rotation;
  widthPx: number;
  heightPx: number;
  children: ReactNode;
}

/** SVG в тех же единицах сетки и с тем же поворотом, что и символ компонента. */
function OverlayFrame({ definition, rotation, widthPx, heightPx, children }: OverlayFrameProps) {
  const { width, height } = definition.visual;
  const quarter = rotation === 90 || rotation === 270;
  return (
    <svg
      aria-hidden="true"
      width={widthPx}
      height={heightPx}
      viewBox={`0 0 ${quarter ? height : width} ${quarter ? width : height}`}
      overflow="visible"
      className="pointer-events-none absolute top-0 left-0"
    >
      <g transform={rotationTransform(rotation, width, height)}>{children}</g>
    </svg>
  );
}

/** Минимальная заметная яркость открытого светодиода (очень малый ток). */
const MIN_VISIBLE_BRIGHTNESS = 0.15;

/** Свечение светодиода: яркость = средний ток по модели симулятора. */
const LedLight = memo(function LedLight({
  componentId,
  color,
  ...frame
}: Omit<OverlayFrameProps, "children"> & { componentId: string; color: string }) {
  const brightness = useSimulationStore((state) => {
    const led = state.components[componentId];
    if (led?.on !== true) return 0;
    return Math.max(led.brightness ?? 0, MIN_VISIBLE_BRIGHTNESS);
  });
  if (brightness === 0) return null;
  const gradientId = `led-glow-${componentId}`;
  return (
    <OverlayFrame {...frame}>
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0%" stopColor={color} stopOpacity={0.9} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle
        cx={2}
        cy={1}
        r={1.2}
        fill={`url(#${gradientId})`}
        opacity={0.3 + 0.7 * brightness}
        data-testid={`led-light-${componentId}`}
        data-brightness={brightness.toFixed(2)}
      />
      <path d="M1.5 0.5 L1.5 1.5 L2.5 1 Z" fill={color} opacity={0.4 + 0.6 * brightness} />
    </OverlayFrame>
  );
});

/**
 * Кнопка, которую можно нажать во время симуляции: мышью (пока удерживается) или
 * клавишами Пробел/Enter, пока кнопка в фокусе. Область нажатия — корпус кнопки, выводы
 * остаются доступными.
 */
const ButtonControl = memo(function ButtonControl({
  componentId,
  ...frame
}: Omit<OverlayFrameProps, "children"> & { componentId: string }) {
  const active = useSimulationStore((state) => ACTIVE_PHASES.has(state.phase));
  const pressed = useSimulationStore((state) => state.components[componentId]?.pressed === true);
  const holding = useRef(false);
  if (!active) return null;

  const press = (next: boolean) => {
    if (holding.current === next) return;
    holding.current = next;
    void setButtonPressed(componentId, next);
  };
  const quarter = frame.rotation === 90 || frame.rotation === 270;
  // Корпус кнопки — средние 2 из 4 клеток по длине символа.
  const style = quarter
    ? { left: 0, width: frame.widthPx, top: GRID_PX, height: GRID_PX * 2 }
    : { left: GRID_PX, width: GRID_PX * 2, top: 0, height: frame.heightPx };

  return (
    <>
      {pressed && (
        <OverlayFrame {...frame}>
          <line x1={1.1} y1={0.95} x2={2.9} y2={0.95} stroke="var(--ring)" strokeWidth={0.14} strokeLinecap="round" />
        </OverlayFrame>
      )}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={pressed}
        aria-label={t("canvas.button.press", { component: componentId })}
        data-testid={`button-control-${componentId}`}
        className="nodrag nopan nokey absolute cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        style={style}
        onPointerDown={(event: PointerEvent) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          press(true);
        }}
        onPointerUp={() => {
          press(false);
        }}
        onPointerLeave={() => {
          press(false);
        }}
        onPointerCancel={() => {
          press(false);
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) press(true);
        }}
        onKeyUp={(event: KeyboardEvent) => {
          if (event.key !== " " && event.key !== "Enter") return;
          event.preventDefault();
          press(false);
        }}
        onBlur={() => {
          press(false);
        }}
      />
    </>
  );
});

/** Встроенный светодиод «L» платы: показывает уровень вывода с возможностью builtin-led. */
const BuiltinLed = memo(function BuiltinLed({ pinId, ...frame }: Omit<OverlayFrameProps, "children"> & { pinId: string }) {
  const level = useSimulationStore((state) => builtinLedLevel(state.pins[pinId]));
  const position = frame.definition.visual.pins[pinId];
  if (position === undefined) return null;
  const x = frame.definition.visual.width / 2 + 2.7;
  const { y } = position;
  return (
    <OverlayFrame {...frame}>
      <g data-testid="builtin-led" data-level={level.toFixed(2)}>
        <title>{t("canvas.builtinLed")}</title>
        <text x={x - 0.55} y={y + 0.17} fontSize={0.45} textAnchor="middle" fill="var(--muted-foreground)" fontFamily="var(--font-code)">
          L
        </text>
        <rect x={x - 0.3} y={y - 0.18} width={0.6} height={0.36} rx={0.05} fill="var(--card)" stroke="var(--foreground)" strokeWidth={0.05} />
        {level > 0 && (
          <rect
            x={x - 0.3}
            y={y - 0.18}
            width={0.6}
            height={0.36}
            rx={0.05}
            fill={LED_FILL["yellow"] ?? "#eab308"}
            opacity={0.25 + 0.75 * level}
          />
        )}
      </g>
    </OverlayFrame>
  );
});

interface SimulationOverlayProps {
  componentId: string;
  definition: ComponentDefinition;
  rotation: Rotation;
  properties: ComponentInstance["properties"] | undefined;
  widthPx: number;
  heightPx: number;
}

/** Слой состояния симуляции для узла; для компонентов без визуального состояния — ничего. */
export const SimulationOverlay = memo(function SimulationOverlay({
  componentId,
  definition,
  rotation,
  properties,
  widthPx,
  heightPx,
}: SimulationOverlayProps) {
  const frame = { definition, rotation, widthPx, heightPx };
  if (definition.type === "led") {
    const color = properties?.["color"];
    const fill = (typeof color === "string" ? LED_FILL[color] : undefined) ?? LED_FILL["red"] ?? "red";
    return <LedLight componentId={componentId} color={fill} {...frame} />;
  }
  if (definition.type === "push-button") {
    return <ButtonControl componentId={componentId} {...frame} />;
  }
  if (definition.category === "board") {
    const pin = definition.pins.find((candidate) => candidate.capabilities?.includes("builtin-led") === true);
    return pin === undefined ? null : <BuiltinLed pinId={pin.id} {...frame} />;
  }
  return null;
});
