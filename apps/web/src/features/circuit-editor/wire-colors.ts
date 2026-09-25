import type { PlainTranslationKey } from "@/i18n/t";

/**
 * Палитра проводов. Цвет провода — только визуальные метаданные: он не несёт
 * электрического смысла и не используется симуляцией. У каждого цвета есть подпись,
 * чтобы выбор не зависел только от различения оттенков.
 */
export const WIRE_COLORS: readonly { value: string; label: PlainTranslationKey }[] = [
  { value: "#dc2626", label: "wire.color.red" },
  { value: "#ea580c", label: "wire.color.orange" },
  { value: "#ca8a04", label: "wire.color.yellow" },
  { value: "#16a34a", label: "wire.color.green" },
  { value: "#2563eb", label: "wire.color.blue" },
  { value: "#9333ea", label: "wire.color.purple" },
  { value: "#737373", label: "wire.color.gray" },
  { value: "#262626", label: "wire.color.black" },
];

/** Цвет провода без заданного цвета — нейтральный токен темы. */
export const DEFAULT_WIRE_COLOR = "var(--wire-default)";

export function wireColorLabel(value: string | undefined): PlainTranslationKey {
  if (value === undefined) {
    return "wire.color.default";
  }
  return WIRE_COLORS.find((color) => color.value.toLowerCase() === value.toLowerCase())?.label ?? "wire.color.custom";
}
