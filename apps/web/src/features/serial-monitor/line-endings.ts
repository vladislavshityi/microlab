import type { PlainTranslationKey } from "@/i18n/t";

export type LineEnding = "none" | "lf" | "cr" | "crlf";

export const LINE_ENDINGS: Readonly<Record<LineEnding, { suffix: string; label: PlainTranslationKey }>> = {
  none: { suffix: "", label: "serial.lineEnding.none" },
  lf: { suffix: "\n", label: "serial.lineEnding.lf" },
  cr: { suffix: "\r", label: "serial.lineEnding.cr" },
  crlf: { suffix: "\r\n", label: "serial.lineEnding.crlf" },
};

export function isLineEnding(value: string): value is LineEnding {
  return value in LINE_ENDINGS;
}
