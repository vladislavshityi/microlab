import type { LocalizedText } from "@microlab/circuit-schema";

/**
 * Текст из определений circuit-schema для активной локали. Определения хранят ключ
 * перевода и русский текст; пока UI только на русском, используется `ru`.
 */
export function localized(text: LocalizedText): string {
  return text.ru;
}
