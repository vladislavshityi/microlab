import { memo } from "react";
import type { ComponentDefinition, ComponentInstance, Rotation } from "@microlab/circuit-schema";

import { localized } from "@/i18n/localized";

/**
 * Собственные упрощённые символы компонентов. Рисуются в единицах сетки (viewBox),
 * поэтому выводы символа совпадают с координатами выводов из определения.
 * Цвета — токены темы; цвет светодиода — только визуальные метаданные.
 */

const STROKE = 0.1;

/** Цвет заливки корпуса светодиода по значению свойства color. */
const LED_FILL: Readonly<Record<string, string>> = {
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  white: "#f5f5f5",
};

function rotationTransform(rotation: Rotation, width: number, height: number): string | undefined {
  switch (rotation) {
    case 0:
      return undefined;
    case 90:
      return `translate(${height} 0) rotate(90)`;
    case 180:
      return `translate(${width} ${height}) rotate(180)`;
    case 270:
      return `translate(0 ${width}) rotate(270)`;
  }
}

function Lead({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--foreground)" strokeWidth={STROKE} />;
}

function PinDot({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={0.14} fill="var(--foreground)" />;
}

function PinLetter({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text x={x} y={y} fontSize={0.42} textAnchor="middle" fill="var(--muted-foreground)" fontFamily="var(--font-code)">
      {children}
    </text>
  );
}

function ResistorSymbol() {
  return (
    <>
      <Lead x1={0} x2={1} y={1} />
      <Lead x1={3} x2={4} y={1} />
      <rect x={1} y={0.6} width={2} height={0.8} rx={0.08} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE} />
      <PinDot x={0} y={1} />
      <PinDot x={4} y={1} />
    </>
  );
}

function LedSymbol({ color }: { color: string }) {
  return (
    <>
      <Lead x1={0} x2={1.5} y={1} />
      <Lead x1={2.5} x2={4} y={1} />
      <path
        d="M1.5 0.5 L1.5 1.5 L2.5 1 Z"
        fill={color}
        fillOpacity={0.75}
        stroke="var(--foreground)"
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <line x1={2.5} y1={0.5} x2={2.5} y2={1.5} stroke="var(--foreground)" strokeWidth={STROKE} />
      <path
        d="M2.05 0.45 L2.45 0.05 M2.45 0.05 L2.2 0.1 M2.45 0.05 L2.4 0.3 M2.5 0.55 L2.9 0.15 M2.9 0.15 L2.65 0.2 M2.9 0.15 L2.85 0.4"
        stroke="var(--foreground)"
        strokeWidth={0.07}
        fill="none"
        strokeLinecap="round"
      />
      <PinDot x={0} y={1} />
      <PinDot x={4} y={1} />
      <PinLetter x={0.6} y={1.7}>A</PinLetter>
      <PinLetter x={3.4} y={1.7}>K</PinLetter>
    </>
  );
}

function PushButtonSymbol() {
  return (
    <>
      <Lead x1={0} x2={1.2} y={1} />
      <Lead x1={2.8} x2={4} y={1} />
      <circle cx={1.3} cy={1} r={0.12} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE * 0.8} />
      <circle cx={2.7} cy={1} r={0.12} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE * 0.8} />
      <line x1={1.1} y1={0.65} x2={2.9} y2={0.65} stroke="var(--foreground)" strokeWidth={STROKE} strokeLinecap="round" />
      <line x1={2} y1={0.65} x2={2} y2={0.25} stroke="var(--foreground)" strokeWidth={STROKE} />
      <line x1={1.6} y1={0.25} x2={2.4} y2={0.25} stroke="var(--foreground)" strokeWidth={STROKE} strokeLinecap="round" />
      <PinDot x={0} y={1} />
      <PinDot x={4} y={1} />
      <PinLetter x={0.6} y={1.7}>A</PinLetter>
      <PinLetter x={3.4} y={1.7}>B</PinLetter>
    </>
  );
}

/** Плата: прямоугольник с подписанными выводами по определению. */
function BoardSymbol({ definition }: { definition: ComponentDefinition }) {
  const { width, height } = definition.visual;
  const inset = 0.6;
  return (
    <>
      <rect
        x={inset}
        y={0}
        width={width - inset * 2}
        height={height}
        rx={0.4}
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeWidth={STROKE}
      />
      {definition.pins.map((pin) => {
        const position = definition.visual.pins[pin.id];
        if (position === undefined) return null;
        const left = position.x === 0;
        return (
          <g key={pin.id}>
            <Lead x1={position.x} x2={left ? inset : width - inset} y={position.y} />
            <PinDot x={position.x} y={position.y} />
            <text
              x={left ? inset + 0.3 : width - inset - 0.3}
              y={position.y + 0.17}
              fontSize={0.5}
              textAnchor={left ? "start" : "end"}
              fill="var(--foreground)"
              fontFamily="var(--font-code)"
            >
              {pin.name}
            </text>
          </g>
        );
      })}
      <text
        x={width / 2}
        y={height / 2}
        fontSize={0.8}
        textAnchor="middle"
        fill="var(--muted-foreground)"
        transform={`rotate(-90 ${width / 2} ${height / 2})`}
      >
        {localized(definition.displayName)}
      </text>
      {definition.board !== undefined && (
        <text
          x={width / 2 + 1}
          y={height / 2}
          fontSize={0.5}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontFamily="var(--font-code)"
          transform={`rotate(-90 ${width / 2 + 1} ${height / 2})`}
        >
          {definition.board.mcu}
        </text>
      )}
    </>
  );
}

function SymbolBody({
  definition,
  properties,
}: {
  definition: ComponentDefinition;
  properties: ComponentInstance["properties"] | undefined;
}) {
  switch (definition.type) {
    case "resistor":
      return <ResistorSymbol />;
    case "led": {
      const color = properties?.["color"];
      return <LedSymbol color={(typeof color === "string" ? LED_FILL[color] : undefined) ?? LED_FILL["red"] ?? "red"} />;
    }
    case "push-button":
      return <PushButtonSymbol />;
    default:
      if (definition.category === "board") {
        return <BoardSymbol definition={definition} />;
      }
      return (
        <rect
          x={0}
          y={0}
          width={definition.visual.width}
          height={definition.visual.height}
          fill="var(--card)"
          stroke="var(--foreground)"
          strokeWidth={STROKE}
        />
      );
  }
}

interface ComponentSymbolProps {
  definition: ComponentDefinition;
  rotation: Rotation;
  properties: ComponentInstance["properties"] | undefined;
  widthPx: number;
  heightPx: number;
}

/** Символ компонента с учётом поворота; размеры в px — повёрнутый прямоугольник. */
export const ComponentSymbol = memo(function ComponentSymbol({
  definition,
  rotation,
  properties,
  widthPx,
  heightPx,
}: ComponentSymbolProps) {
  const { width, height } = definition.visual;
  const rotatedWidth = rotation === 90 || rotation === 270 ? height : width;
  const rotatedHeight = rotation === 90 || rotation === 270 ? width : height;
  return (
    <svg
      aria-hidden="true"
      width={widthPx}
      height={heightPx}
      viewBox={`0 0 ${rotatedWidth} ${rotatedHeight}`}
      overflow="visible"
      className="block"
    >
      <g transform={rotationTransform(rotation, width, height)}>
        <SymbolBody definition={definition} properties={properties} />
      </g>
    </svg>
  );
});
