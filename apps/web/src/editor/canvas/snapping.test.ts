import { describe, expect, it } from "vitest";
import { snapPoint, snapValue } from "./snapping";

describe("snapValue", () => {
  it("snaps to the nearest multiple", () => {
    expect(snapValue(47, 40)).toBe(40);
    expect(snapValue(61, 40)).toBe(80);
    expect(snapValue(-47, 40)).toBe(-40);
  });

  it("leaves the value untouched when the grid is disabled", () => {
    expect(snapValue(47, 0)).toBe(47);
    expect(snapValue(47, -10)).toBe(47);
    expect(snapValue(47, Number.NaN)).toBe(47);
  });

  it("is idempotent on already-snapped values", () => {
    expect(snapValue(snapValue(47, 40), 40)).toBe(40);
  });
});

describe("snapPoint", () => {
  it("snaps both axes", () => {
    expect(snapPoint({ x: 47, y: 82 }, 40)).toEqual({ x: 40, y: 80 });
  });
});
