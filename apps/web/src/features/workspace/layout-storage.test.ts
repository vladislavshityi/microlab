import { describe, expect, it } from "vitest";

import { readLayout, writeLayout } from "./layout-storage";

const PANELS = ["a", "b"] as const;

describe("layout storage", () => {
  it("restores a valid saved layout", () => {
    writeLayout("group", { a: 30, b: 70 });
    expect(readLayout("group", PANELS)).toEqual({ a: 30, b: 70 });
  });

  it.each([
    ["missing", null],
    ["corrupted JSON", "{not json"],
    ["unknown panel", JSON.stringify({ a: 30, c: 70 })],
    ["missing panel", JSON.stringify({ a: 100 })],
    ["non-numeric size", JSON.stringify({ a: "30", b: 70 })],
    ["sizes not adding up", JSON.stringify({ a: 10, b: 10 })],
    ["array", JSON.stringify([30, 70])],
  ])("falls back to defaults: %s", (_name, stored) => {
    if (stored !== null) {
      window.localStorage.setItem("microlab.layout.group", stored);
    }
    expect(readLayout("group", PANELS)).toBeUndefined();
  });
});
