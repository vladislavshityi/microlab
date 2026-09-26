import { memo } from "react";
import type { ComponentDefinition, ComponentInstance, Rotation } from "@microlab/circuit-schema";

import { localized } from "@/i18n/localized";

import { PIEZO_BODY, RGB_BODY, SEGMENT_DP, SEGMENT_LINES, SEGMENT_WIDTH } from "./component-geometry";
import { LED_FILL } from "./led-colors";
import { rotationTransform } from "./rotation";

/**
 * Собственные упрощённые символы компонентов. Рисуются в единицах сетки (viewBox),
 * поэтому выводы символа совпадают с координатами выводов из определения.
 * Цвета — токены темы; цвет светодиода — только визуальные метаданные.
 */

const STROKE = 0.1;


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

function VLead({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return <line x1={x} y1={y1} x2={x} y2={y2} stroke="var(--foreground)" strokeWidth={STROKE} />;
}

/** Потенциометр: резистор между выводами 1 и 2; движок рисует слой симуляции. */
function PotentiometerSymbol() {
  return (
    <>
      <Lead x1={0} x2={1} y={2} />
      <Lead x1={3} x2={4} y={2} />
      <rect x={1} y={1.6} width={2} height={0.8} rx={0.08} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE} />
      <PinDot x={0} y={2} />
      <PinDot x={4} y={2} />
      <PinDot x={2} y={0} />
      <PinLetter x={0.4} y={2.7}>1</PinLetter>
      <PinLetter x={3.6} y={2.7}>2</PinLetter>
      <PinLetter x={2.45} y={0.4}>W</PinLetter>
    </>
  );
}

function LightArrow({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M${x} ${y} L${x + 0.45} ${y + 0.45} M${x + 0.45} ${y + 0.45} L${x + 0.2} ${y + 0.4} M${x + 0.45} ${y + 0.45} L${x + 0.4} ${y + 0.2}`}
      stroke="var(--foreground)"
      strokeWidth={0.07}
      fill="none"
      strokeLinecap="round"
    />
  );
}

function PhotoresistorSymbol() {
  return (
    <>
      <ResistorSymbol />
      <LightArrow x={1.2} y={0} />
      <LightArrow x={1.75} y={0} />
    </>
  );
}

function RgbLedSymbol() {
  const bottom = RGB_BODY.cy + RGB_BODY.r;
  return (
    <>
      {[0, 1, 2, 3].map((x) => (
        <VLead key={x} x={x} y1={bottom - 0.1} y2={3} />
      ))}
      <circle cx={RGB_BODY.cx} cy={RGB_BODY.cy} r={RGB_BODY.r} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE} />
      <text x={RGB_BODY.cx} y={RGB_BODY.cy + 0.17} fontSize={0.45} textAnchor="middle" fill="var(--muted-foreground)" fontFamily="var(--font-code)">
        RGB
      </text>
      {[0, 1, 2, 3].map((x) => (
        <PinDot key={x} x={x} y={3} />
      ))}
      {(["R", "C", "G", "B"] as const).map((letter, x) => (
        <PinLetter key={letter} x={x + 0.3} y={2.75}>
          {letter}
        </PinLetter>
      ))}
    </>
  );
}

function SevenSegmentSymbol() {
  const top = ["G", "F", "C", "A", "B"];
  const bottom = ["E", "D", "C", "C", "P"];
  return (
    <>
      {[0, 1, 2, 3, 4].map((x) => (
        <g key={x}>
          <VLead x={x} y1={0} y2={0.6} />
          <VLead x={x} y1={5.4} y2={6} />
        </g>
      ))}
      <rect x={0.3} y={0.6} width={3.4} height={4.8} rx={0.15} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE} />
      {Object.entries(SEGMENT_LINES).map(([id, [x1, y1, x2, y2]]) => (
        <line
          key={id}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="var(--muted-foreground)"
          strokeOpacity={0.25}
          strokeWidth={SEGMENT_WIDTH}
          strokeLinecap="round"
        />
      ))}
      <circle cx={SEGMENT_DP.cx} cy={SEGMENT_DP.cy} r={SEGMENT_DP.r} fill="var(--muted-foreground)" fillOpacity={0.25} />
      {[0, 1, 2, 3, 4].map((x) => (
        <g key={x}>
          <PinDot x={x} y={0} />
          <PinDot x={x} y={6} />
        </g>
      ))}
      {top.map((letter, x) => (
        <text key={`t${x}`} x={x + 0.22} y={0.45} fontSize={0.32} fill="var(--muted-foreground)" fontFamily="var(--font-code)">
          {letter}
        </text>
      ))}
      {bottom.map((letter, x) => (
        <text key={`b${x}`} x={x + 0.22} y={5.85} fontSize={0.32} fill="var(--muted-foreground)" fontFamily="var(--font-code)">
          {letter}
        </text>
      ))}
    </>
  );
}

function PiezoSymbol() {
  const bottom = PIEZO_BODY.cy + PIEZO_BODY.r;
  return (
    <>
      <VLead x={1} y1={bottom - 0.2} y2={3} />
      <VLead x={3} y1={bottom - 0.6} y2={3} />
      <circle cx={PIEZO_BODY.cx} cy={PIEZO_BODY.cy} r={PIEZO_BODY.r} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE} />
      <circle cx={PIEZO_BODY.cx} cy={PIEZO_BODY.cy} r={0.25} fill="none" stroke="var(--foreground)" strokeWidth={0.06} />
      <PinDot x={1} y={3} />
      <PinDot x={3} y={3} />
      <PinLetter x={0.6} y={2.8}>+</PinLetter>
      <PinLetter x={3.4} y={2.8}>−</PinLetter>
    </>
  );
}

/** Сервопривод: корпус и вал; качалку рисует слой симуляции. */
function ServoSymbol() {
  return (
    <>
      <Lead x1={0} x2={0.8} y={1} />
      <Lead x1={0} x2={0.8} y={2} />
      <Lead x1={0} x2={0.8} y={3} />
      <rect x={0.8} y={0.3} width={4.6} height={3.4} rx={0.2} fill="var(--card)" stroke="var(--foreground)" strokeWidth={STROKE} />
      {(["GND", "V+", "SIG"] as const).map((label, i) => (
        <text key={label} x={1.0} y={i + 1.15} fontSize={0.36} fill="var(--muted-foreground)" fontFamily="var(--font-code)">
          {label}
        </text>
      ))}
      <PinDot x={0} y={1} />
      <PinDot x={0} y={2} />
      <PinDot x={0} y={3} />
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
    case "potentiometer":
      return <PotentiometerSymbol />;
    case "photoresistor":
      return <PhotoresistorSymbol />;
    case "rgb-led":
      return <RgbLedSymbol />;
    case "seven-segment":
      return <SevenSegmentSymbol />;
    case "piezo-buzzer":
      return <PiezoSymbol />;
    case "servo":
      return <ServoSymbol />;
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
