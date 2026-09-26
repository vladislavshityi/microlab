import { describe, expect, it } from "vitest";

import { formatQuantity, formatQuantityText, parseQuantity } from "./quantity";

describe("parseQuantity (ohm)", () => {
  it.each([
    ["220", 220],
    ["220 Ω", 220],
    ["220Ом", 220],
    ["4.7k", 4700],
    ["4,7k", 4700],
    ["4,7 кОм", 4700],
    ["4.7 kΩ", 4700],
    ["10 kΩ", 10000],
    ["10K", 10000],
    ["4k7", 4700],
    ["4К7", 4700],
    ["2.2k", 2200],
    ["1M", 1_000_000],
    ["1 МОм", 1_000_000],
    ["1 MΩ", 1_000_000],
    ["1meg", 1_000_000],
    ["4R7", 4.7],
    ["1e3", 1000],
    ["  330  ", 330],
  ])("%s → %d Ω", (input, expected) => {
    expect(parseQuantity(input, "ohm")).toBe(expected);
  });

  it("treats lowercase m as milli (SI), not mega", () => {
    expect(parseQuantity("1 мОм", "ohm")).toBe(0.001);
    expect(parseQuantity("1m", "ohm")).toBe(0.001);
  });

  it.each(["", "abc", "4.7x", "k", "1..2", "Ом", "4k7k"])("rejects %j", (input) => {
    expect(parseQuantity(input, "ohm")).toBeNull();
  });
});

describe("parseQuantity (other units)", () => {
  it("parses volts and percent", () => {
    expect(parseQuantity("2,2 В", "volt")).toBe(2.2);
    expect(parseQuantity("3V", "volt")).toBe(3);
    expect(parseQuantity("5 %", "percent")).toBe(5);
    expect(parseQuantity("5k", "percent")).toBeNull();
  });
});

describe("parseQuantity (lux, microseconds, dimensionless)", () => {
  it("parses illuminance with kilo prefix", () => {
    expect(parseQuantity("350", "lux")).toBe(350);
    expect(parseQuantity("1,5 клк", "lux")).toBe(1500);
    expect(parseQuantity("10k lx", "lux")).toBe(10000);
    expect(formatQuantityText(20000, "lux", "ru-RU")).toBe("20 клк");
  });

  it("parses pulse widths and plain numbers", () => {
    expect(parseQuantity("544 мкс", "microsecond")).toBe(544);
    expect(parseQuantity("2400us", "microsecond")).toBe(2400);
    expect(parseQuantity("1k", "microsecond")).toBeNull();
    expect(parseQuantity("0,7", "none")).toBe(0.7);
    expect(formatQuantityText(0.7, "none", "ru-RU")).toBe("0,7");
  });
});

describe("formatQuantity", () => {
  it("uses Ω, kΩ and MΩ with the locale decimal separator", () => {
    expect(formatQuantity(220, "ohm", "ru-RU")).toEqual({ value: "220", unit: "Ω" });
    expect(formatQuantity(4700, "ohm", "ru-RU")).toEqual({ value: "4,7", unit: "kΩ" });
    expect(formatQuantity(1_000_000, "ohm", "ru-RU")).toEqual({ value: "1", unit: "MΩ" });
    expect(formatQuantityText(2, "volt", "ru-RU")).toBe("2 В");
  });

  it("round-trips through the parser", () => {
    for (const value of [100, 220, 330, 470, 1000, 2200, 4700, 10000, 100000, 1000000]) {
      expect(parseQuantity(formatQuantityText(value, "ohm", "ru-RU"), "ohm")).toBe(value);
    }
  });
});
