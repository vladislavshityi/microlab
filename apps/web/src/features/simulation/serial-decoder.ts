/**
 * Декодер вывода Serial для монитора порта: байты → текст.
 *
 * Корректные последовательности UTF-8 (в том числе ASCII) показываются как текст, в том
 * числе если последовательность разрезана между пачками событий. Непечатаемые управляющие
 * символы и байты, не образующие корректный UTF-8, показываются экранированными (`\x07`,
 * `\xFF`). Перевод строки — `\n`; `\r` перед `\n` (Serial.println) и одиночный `\r`
 * не отображаются, табуляция сохраняется.
 */
export class SerialDecoder {
  /** Начатая, но ещё не завершённая многобайтовая последовательность. */
  private pending: number[] = [];

  reset(): void {
    this.pending = [];
  }

  push(bytes: readonly number[]): string {
    let out = "";
    for (const byte of bytes) {
      if (this.pending.length > 0) {
        if ((byte & 0xc0) === 0x80) {
          this.pending.push(byte);
          const first = this.pending[0] ?? 0;
          if (this.pending.length === sequenceLength(first)) {
            out += decodeSequence(this.pending);
            this.pending = [];
          }
          continue;
        }
        // Последовательность оборвалась: её байты некорректны.
        out += this.pending.map(escapeByte).join("");
        this.pending = [];
      }
      if (byte < 0x80) {
        out += asciiChar(byte);
      } else if (sequenceLength(byte) > 1) {
        this.pending = [byte];
      } else {
        out += escapeByte(byte);
      }
    }
    return out;
  }
}

function sequenceLength(first: number): number {
  if (first >= 0xc2 && first <= 0xdf) return 2;
  if (first >= 0xe0 && first <= 0xef) return 3;
  if (first >= 0xf0 && first <= 0xf4) return 4;
  return 1;
}

function escapeByte(byte: number): string {
  return `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}

function asciiChar(byte: number): string {
  if (byte === 0x0a || byte === 0x09) return String.fromCharCode(byte);
  if (byte === 0x0d) return "";
  if (byte < 0x20 || byte === 0x7f) return escapeByte(byte);
  return String.fromCharCode(byte);
}

function decodeSequence(bytes: readonly number[]): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  // Overlong-формы и суррогаты TextDecoder заменяет на U+FFFD: показываем исходные байты.
  if (text.includes("�")) return bytes.map(escapeByte).join("");
  const code = text.codePointAt(0) ?? 0;
  // Управляющие символы C1 тоже непечатаемые.
  if (code >= 0x80 && code <= 0x9f) return bytes.map(escapeByte).join("");
  return text;
}
