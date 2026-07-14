import { describe, expect, it } from "vitest";
import {
  clampScale,
  fitView,
  nativeToScreen,
  SCALE_MAX,
  SCALE_MIN,
  screenToNative,
  zoomAt,
} from "./coords";

describe("nativeToScreen / screenToNative", () => {
  it("round-trips a point through both transforms", () => {
    const view = { scale: 1.5, x: 40, y: -20 };
    const p = { x: 123, y: 456 };
    const back = screenToNative(nativeToScreen(p, view), view);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it("applies scale then translation", () => {
    expect(nativeToScreen({ x: 10, y: 0 }, { scale: 2, x: 5, y: 0 })).toEqual({
      x: 25,
      y: 0,
    });
  });
});

describe("clampScale", () => {
  it("clamps into [SCALE_MIN, SCALE_MAX]", () => {
    expect(clampScale(1000)).toBe(SCALE_MAX);
    expect(clampScale(0)).toBe(SCALE_MIN);
    expect(clampScale(1)).toBe(1);
  });
});

describe("fitView", () => {
  it("returns the identity view for degenerate inputs", () => {
    expect(
      fitView({ width: 0, height: 0 }, { width: 100, height: 100 }),
    ).toEqual({ scale: 1, x: 0, y: 0 });
    expect(
      fitView({ width: 100, height: 100 }, { width: 0, height: 0 }),
    ).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("scales and centres content that shares the container aspect", () => {
    const view = fitView(
      { width: 1000, height: 1000 },
      { width: 500, height: 500 },
      0,
    );
    expect(view.scale).toBe(0.5);
    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
  });

  it("centres on the constrained axis when aspect ratios differ", () => {
    const view = fitView(
      { width: 1600, height: 900 },
      { width: 800, height: 800 },
      0,
    );
    expect(view.scale).toBeCloseTo(0.5); // width-limited: 800 / 1600
    expect(view.x).toBeCloseTo(0);
    expect(view.y).toBeCloseTo((800 - 900 * 0.5) / 2); // 175
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed on screen", () => {
    const view = { scale: 1, x: 0, y: 0 };
    const focal = { x: 200, y: 150 };
    const nativeBefore = screenToNative(focal, view);
    const zoomed = zoomAt(view, focal, 2);
    expect(zoomed.scale).toBe(2);
    const screenAfter = nativeToScreen(nativeBefore, zoomed);
    expect(screenAfter.x).toBeCloseTo(focal.x);
    expect(screenAfter.y).toBeCloseTo(focal.y);
  });

  it("clamps at the maximum scale", () => {
    const zoomed = zoomAt({ scale: SCALE_MAX, x: 0, y: 0 }, { x: 0, y: 0 }, 4);
    expect(zoomed.scale).toBe(SCALE_MAX);
  });
});
