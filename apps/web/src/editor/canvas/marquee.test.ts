import { describe, expect, it } from "vitest";
import type { PlanObject } from "@raidplan/shared";
import {
  normalizeRect,
  objectBounds,
  objectsInMarquee,
  rectsIntersect,
} from "./marquee";

function obj(
  id: string,
  base: Partial<PlanObject["base"]> = {},
  extra: Partial<PlanObject> = {},
): PlanObject {
  return {
    id,
    type: "token",
    base: {
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      opacity: 1,
      z: 0,
      visible: true,
      ...base,
    },
    ...extra,
  };
}

describe("normalizeRect", () => {
  it("builds a positive rect regardless of drag direction", () => {
    const expected = { x: 10, y: 20, width: 90, height: 80 };
    // dragged down-right, up-left, and the two mixed diagonals
    expect(normalizeRect({ x: 10, y: 20 }, { x: 100, y: 100 })).toEqual(
      expected,
    );
    expect(normalizeRect({ x: 100, y: 100 }, { x: 10, y: 20 })).toEqual(
      expected,
    );
    expect(normalizeRect({ x: 100, y: 20 }, { x: 10, y: 100 })).toEqual(
      expected,
    );
    expect(normalizeRect({ x: 10, y: 100 }, { x: 100, y: 20 })).toEqual(
      expected,
    );
  });

  it("collapses to a zero-size rect for a click", () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("objectBounds", () => {
  it("is the plain box for an unrotated object", () => {
    expect(objectBounds(obj("a", { x: 10, y: 20, w: 30, h: 40 }))).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it("grows to bound a 45°-rotated square", () => {
    // A 100x100 square rotated 45° about its top-left corner spans 100*√2
    // horizontally, and vertically from the origin down to 100*√2.
    const bounds = objectBounds(obj("a", { rotation: 45 }));
    const diagonal = 100 * Math.SQRT2;
    expect(bounds.width).toBeCloseTo(diagonal);
    expect(bounds.height).toBeCloseTo(diagonal);
    expect(bounds.x).toBeCloseTo(-100 / Math.SQRT2);
    expect(bounds.y).toBeCloseTo(0);
  });

  it("returns the same box for a 90° rotation, swapped", () => {
    const bounds = objectBounds(
      obj("a", { x: 0, y: 0, w: 40, h: 10, rotation: 90 }),
    );
    expect(bounds.width).toBeCloseTo(10);
    expect(bounds.height).toBeCloseTo(40);
  });
});

describe("rectsIntersect", () => {
  const base = { x: 0, y: 0, width: 10, height: 10 };

  it("detects overlap and containment", () => {
    expect(rectsIntersect(base, { x: 5, y: 5, width: 10, height: 10 })).toBe(
      true,
    );
    expect(rectsIntersect(base, { x: 2, y: 2, width: 2, height: 2 })).toBe(
      true,
    );
  });

  it("counts touching edges as intersecting", () => {
    expect(rectsIntersect(base, { x: 10, y: 0, width: 5, height: 5 })).toBe(
      true,
    );
  });

  it("rejects separated rects on either axis", () => {
    expect(rectsIntersect(base, { x: 11, y: 0, width: 5, height: 5 })).toBe(
      false,
    );
    expect(rectsIntersect(base, { x: 0, y: 11, width: 5, height: 5 })).toBe(
      false,
    );
  });
});

describe("objectsInMarquee", () => {
  const marquee = { x: 0, y: 0, width: 150, height: 150 };

  it("selects objects the sweep touches, in the given z-order", () => {
    const objects = [
      obj("a", { x: 0, y: 0 }),
      obj("b", { x: 120, y: 120 }), // only a corner is swept
      obj("c", { x: 400, y: 400 }), // far outside
    ];
    expect(objectsInMarquee(objects, marquee)).toEqual(["a", "b"]);
  });

  it("selects on partial overlap, not just full containment", () => {
    // Straddles the marquee's right edge.
    expect(objectsInMarquee([obj("a", { x: 100, y: 0 })], marquee)).toEqual([
      "a",
    ]);
  });

  it("skips hidden objects", () => {
    expect(objectsInMarquee([obj("a", { visible: false })], marquee)).toEqual(
      [],
    );
  });

  it("skips locked objects", () => {
    expect(objectsInMarquee([obj("a", {}, { locked: true })], marquee)).toEqual(
      [],
    );
  });

  it("accounts for rotation when deciding what was swept", () => {
    // Unrotated this sits clear of the marquee; rotated, a corner swings into it.
    const outside = obj("a", { x: 160, y: 0, w: 100, h: 100 });
    expect(objectsInMarquee([outside], marquee)).toEqual([]);
    expect(
      objectsInMarquee(
        [obj("a", { x: 160, y: 0, w: 100, h: 100, rotation: 45 })],
        marquee,
      ),
    ).toEqual(["a"]);
  });

  it("returns nothing for an empty sweep", () => {
    expect(
      objectsInMarquee([obj("a")], { x: 500, y: 500, width: 0, height: 0 }),
    ).toEqual([]);
  });
});
