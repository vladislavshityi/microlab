import type { GridPoint } from "@microlab/circuit-schema";
import { describe, expect, it } from "vitest";

import { autoRoute, moveSegment, orthogonalize, simplifyPolyline, wirePolyline } from "./routing";

function expectOrthogonal(points: readonly GridPoint[]) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    expect(a !== undefined && b !== undefined && (a.x === b.x || a.y === b.y)).toBe(true);
  }
}

describe("routing", () => {
  it("routes horizontal pins with a Z through the rounded middle", () => {
    const points = autoRoute({ x: 0, y: 0 }, "right", { x: 5, y: 4 }, "left");
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
      { x: 5, y: 4 },
    ]);
  });

  it("routes vertical pins with a Z and mixed pins with an L", () => {
    expect(autoRoute({ x: 0, y: 0 }, "down", { x: 4, y: 6 }, "up")).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 6 },
    ]);
    expect(autoRoute({ x: 0, y: 0 }, "right", { x: 4, y: 6 }, "up")).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 6 },
    ]);
    expect(autoRoute({ x: 0, y: 0 }, "down", { x: 4, y: 6 }, "left")).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 6 },
      { x: 4, y: 6 },
    ]);
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
