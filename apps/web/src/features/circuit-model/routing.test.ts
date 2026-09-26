import type { GridPoint } from "@microlab/circuit-schema";
import { describe, expect, it } from "vitest";

import { autoRoute, moveSegment, orthogonalize, simplifyPolyline, wirePolyline } from "./routing";

const OPPOSITE = { left: "right", right: "left", up: "down", down: "up" } as const;

function direction(a: GridPoint, b: GridPoint): string {
  if (a.x === b.x) return b.y > a.y ? "down" : "up";
  return b.x > a.x ? "right" : "left";
}

function firstDirection(points: readonly GridPoint[]): string | undefined {
  const [a, b] = points;
  return a === undefined || b === undefined ? undefined : direction(a, b);
}

function lastDirection(points: readonly GridPoint[]): string | undefined {
  const a = points.at(-2);
  const b = points.at(-1);
  return a === undefined || b === undefined ? undefined : direction(a, b);
}

function hasReversal(points: readonly GridPoint[]): boolean {
  for (let i = 0; i + 2 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const c = points[i + 2];
    if (a === undefined || b === undefined || c === undefined) continue;
    const d1 = direction(a, b);
    const d2 = direction(b, c);
    if (OPPOSITE[d1 as keyof typeof OPPOSITE] === d2) return true;
  }
  return false;
}

function expectOrthogonal(points: readonly GridPoint[]) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    expect(a !== undefined && b !== undefined && (a.x === b.x || a.y === b.y)).toBe(true);
  }
}

describe("routing", () => {
  it("leaves each pin outward and never turns back through the symbol", () => {
    const directions = ["left", "right", "up", "down"] as const;
    for (const a of directions) {
      for (const b of directions) {
        for (const to of [
          { x: 6, y: 4 },
          { x: -6, y: 4 },
          { x: 6, y: -4 },
          { x: 0, y: 5 },
          { x: 5, y: 0 },
        ]) {
          const from = { x: 0, y: 0 };
          const points = autoRoute(from, a, to, b);
          expectOrthogonal(points);
          expect(points[0]).toEqual(from);
          expect(points.at(-1)).toEqual(to);
          expect(firstDirection(points)).toBe(a);
          expect(lastDirection(points)).toBe(OPPOSITE[b]);
          expect(hasReversal(points)).toBe(false);
        }
      }
    }
  });

  it("routes around the bodies of the connected components", () => {
    // Вывод слева на корпусе 4×2, цель справа: провод обходит корпус, а не идёт сквозь него.
    const body = { x: 0, y: 0, width: 4, height: 2 };
    const points = autoRoute({ x: 0, y: 1 }, "left", { x: 10, y: 1 }, "left", [body]);
    expectOrthogonal(points);
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a === undefined || b === undefined) continue;
      if (a.y === b.y) {
        const inside = a.y > body.y && a.y < body.y + body.height;
        expect(inside && Math.max(a.x, b.x) > body.x && Math.min(a.x, b.x) < body.x + body.width).toBe(false);
      }
    }
  });

  it("connects facing pins with a straight wire and simple offsets with a Z", () => {
    expect(autoRoute({ x: 0, y: 0 }, "right", { x: 6, y: 0 }, "left")).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ]);
    const z = autoRoute({ x: 0, y: 0 }, "right", { x: 6, y: 4 }, "left");
    expect(z).toHaveLength(4);
    expectOrthogonal(z);
  });

  it("uses a straight segment for aligned pins", () => {
    expect(autoRoute({ x: 1, y: 2 }, "right", { x: 9, y: 2 }, "left")).toEqual([
      { x: 1, y: 2 },
      { x: 9, y: 2 },
    ]);
  });

  it("never produces diagonal segments", () => {
    const directions = ["left", "right", "up", "down", null] as const;
    for (const a of directions) {
      for (const b of directions) {
        expectOrthogonal(autoRoute({ x: -3, y: 7 }, a, { x: 11, y: -2 }, b));
      }
    }
    expectOrthogonal(orthogonalize([{ x: 0, y: 0 }, { x: 3, y: 5 }, { x: -2, y: 1 }]));
  });

  it("follows stored waypoints and inserts corners where needed", () => {
    // Трасса из эталонного примера: D13 (12,6) → (16,6) → (16,9) → вывод резистора (20,9).
    const points = wirePolyline({ x: 12, y: 6 }, "right", { x: 20, y: 9 }, "left", [
      { x: 16, y: 6 },
      { x: 16, y: 9 },
    ]);
    expect(points).toEqual([
      { x: 12, y: 6 },
      { x: 16, y: 6 },
      { x: 16, y: 9 },
      { x: 20, y: 9 },
    ]);
    expectOrthogonal(wirePolyline({ x: 0, y: 0 }, null, { x: 9, y: 9 }, null, [{ x: 4, y: 5 }]));
  });

  it("removes duplicate and collinear points", () => {
    expect(
      simplifyPolyline([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 3 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 3 },
    ]);
  });

  it("moves a middle segment and keeps the ends on the pins", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 6, y: 4 },
    ];
    const route = moveSegment(points, 1, 2);
    expect(route).toEqual([
      { x: 5, y: 0 },
      { x: 5, y: 4 },
    ]);
    const full = wirePolyline({ x: 0, y: 0 }, "right", { x: 6, y: 4 }, "left", route ?? []);
    expect(full[0]).toEqual({ x: 0, y: 0 });
    expect(full.at(-1)).toEqual({ x: 6, y: 4 });
    expectOrthogonal(full);
  });

  it("moving an end segment adds a perpendicular stub at the pin", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ];
    const route = moveSegment(points, 0, -2);
    expect(route).toEqual([
      { x: 0, y: -2 },
      { x: 6, y: -2 },
    ]);
    expectOrthogonal([{ x: 0, y: 0 }, ...(route ?? []), { x: 6, y: 0 }]);
  });

  it("rejects missing or zero-length segments", () => {
    expect(moveSegment([{ x: 0, y: 0 }], 0, 1)).toBeNull();
    expect(
      moveSegment(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        0,
        1,
      ),
    ).toBeNull();
  });
});
