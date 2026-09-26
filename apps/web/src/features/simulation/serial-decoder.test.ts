import { describe, expect, it } from "vitest";

import { SerialDecoder } from "./serial-decoder";

function bytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

describe("SerialDecoder", () => {
  it("decodes ASCII and drops CR of CRLF", () => {
    expect(new SerialDecoder().push(bytes("on\r\noff\r\n"))).toBe("on\noff\n");
  });

  it("decodes UTF-8 split between chunks", () => {
    const decoder = new SerialDecoder();
    const encoded = bytes("Привет");
    expect(decoder.push(encoded.slice(0, 3))).toBe("П");
    expect(decoder.push(encoded.slice(3))).toBe("ривет");
  });

  it("escapes control characters and invalid bytes", () => {
    const decoder = new SerialDecoder();
    expect(decoder.push([0x41, 0x00, 0x07, 0x09, 0x7f, 0xff, 0x80])).toBe("A\\x00\\x07\t\\x7F\\xFF\\x80");
    // Оборванная последовательность: байт начала экранируется, следующий символ сохраняется.
    expect(decoder.push([0xd0, 0x41])).toBe("\\xD0A");
    // Overlong-кодирование не считается текстом.
    expect(decoder.push([0xe0, 0x80, 0x80])).toBe("\\xE0\\x80\\x80");
  });
});
