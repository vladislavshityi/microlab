import type { PropertyUnit } from "@microlab/circuit-schema";

/**
 * Разбор и форматирование значений свойств с единицами измерения.
 * Внутри модели значения хранятся в базовых единицах (Ом, В, %).
 */

/** Обозначения единиц, которые допускаются после числа (без учёта регистра). */
const UNIT_SUFFIXES: Readonly<Record<PropertyUnit, readonly string[]>> = {
  ohm: ["ohms", "ohm", "ом", "ω", "Ω"],
  volt: ["volts", "volt", "в", "v"],
  percent: ["%"],
};

/** Множители SI. Прописная M/М — мега, строчная m/м — милли (как в обозначениях SI). */
const MULTIPLIERS: readonly { symbols: readonly string[]; factor: number; caseSensitive: boolean }[] = [
  { symbols: ["meg", "мег"], factor: 1e6, caseSensitive: false },
  { symbols: ["G", "Г"], factor: 1e9, caseSensitive: true },
  { symbols: ["M", "М"], factor: 1e6, caseSensitive: true },
  { symbols: ["k", "K", "к", "К"], factor: 1e3, caseSensitive: true },
  { symbols: ["m", "м"], factor: 1e-3, caseSensitive: true },
  { symbols: ["u", "µ", "μ", "мк"], factor: 1e-6, caseSensitive: true },
];

/** Какие множители имеют смысл для единицы. */
const UNIT_ALLOWS_MULTIPLIERS: Readonly<Record<PropertyUnit, boolean>> = {
  ohm: true,
  volt: true,
  percent: false,
};

function stripUnit(text: string, unit: PropertyUnit): string {
  const lower = text.toLocaleLowerCase("ru-RU");
  for (const suffix of UNIT_SUFFIXES[unit]) {
    if (lower.endsWith(suffix.toLocaleLowerCase("ru-RU"))) {
      return text.slice(0, text.length - suffix.length).trim();
    }
  }
  return text;
}

function splitMultiplier(text: string): { number: string; factor: number } | null {
  for (const { symbols, factor, caseSensitive } of MULTIPLIERS) {
    for (const symbol of symbols) {
      const matches = caseSensitive
        ? text.endsWith(symbol)
        : text.toLocaleLowerCase("ru-RU").endsWith(symbol);
      if (matches) {
        return { number: text.slice(0, text.length - symbol.length).trim(), factor };
      }
      // Обозначение «4k7» / «4К7»: множитель на месте десятичного разделителя.
      const infix = new RegExp(`^(\\d+)${symbol}(\\d+)$`, caseSensitive ? "" : "i").exec(text);
      if (infix?.[1] !== undefined && infix[2] !== undefined) {
        return { number: `${infix[1]}.${infix[2]}`, factor };
      }
    }
  }
  return null;
}

const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Разбирает строку ввода в значение в базовых единицах: «220», «4.7k», «4,7 кОм»,
 * «1M», «10 kΩ», «4k7», «2,2 В». Возвращает null, если строку нельзя однозначно разобрать.
 */
export function parseQuantity(input: string, unit: PropertyUnit): number | null {
  let text = input.trim().replace(/\s+/g, " ");
  if (text === "") {
    return null;
  }
  text = stripUnit(text, unit).replace(/\s/g, "").replace(",", ".");
  let factor = 1;
  if (UNIT_ALLOWS_MULTIPLIERS[unit] && !NUMBER_PATTERN.test(text)) {
    // Обозначение «4R7» для резисторов: R на месте десятичного разделителя.
    const rNotation = unit === "ohm" ? /^(\d+)[rR](\d*)$/.exec(text) : null;
    if (rNotation?.[1] !== undefined) {
      text = `${rNotation[1]}.${rNotation[2] ?? ""}`;
    } else {
      const split = splitMultiplier(text);
      if (split === null) {
        return null;
      }
      text = split.number;
      factor = split.factor;
    }
  }
  if (!NUMBER_PATTERN.test(text)) {
    return null;
  }
  const value = Number(text) * factor;
  if (!Number.isFinite(value)) {
    return null;
  }
  // Убирает ошибки двоичного представления (4.7 × 1000 = 4700.000000000001).
  return Number(value.toPrecision(12));
}

export interface FormattedQuantity {
  value: string;
  /** Обозначение единицы с приставкой: «Ω», «kΩ», «MΩ», «В», «%». */
  unit: string;
}

const UNIT_SYMBOLS: Readonly<Record<PropertyUnit, string>> = {
  ohm: "Ω",
  volt: "В",
  percent: "%",
};

/** Форматирует значение с подходящей приставкой (для сопротивления — Ω, kΩ, MΩ). */
export function formatQuantity(value: number, unit: PropertyUnit, locale: string): FormattedQuantity {
  const format = (n: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 3, useGrouping: false }).format(n);
  if (unit === "ohm") {
    if (Math.abs(value) >= 1e6) return { value: format(value / 1e6), unit: "MΩ" };
    if (Math.abs(value) >= 1e3) return { value: format(value / 1e3), unit: "kΩ" };
  }
  return { value: format(value), unit: UNIT_SYMBOLS[unit] };
}

export function formatQuantityText(value: number, unit: PropertyUnit, locale: string): string {
  const formatted = formatQuantity(value, unit, locale);
  return `${formatted.value} ${formatted.unit}`;
}
