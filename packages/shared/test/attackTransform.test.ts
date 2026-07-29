import { describe, expect, it } from "vitest";
import {
  IDENTITY_ATTACK_TRANSFORM,
  type AttackTransform,
} from "../src/attack.js";
import type { SlideState } from "../src/plan.js";
import {
  attackAnchor,
  localScale,
  placementTransform,
  transformDir,
  transformPoint,
  transformState,
  wouldDegrade,
} from "../src/attackTransform.js";
import { centrePoint } from "../src/transform.js";

const state = (over: Partial<SlideState> = {}): SlideState => ({
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  rotation: 0,
  opacity: 1,
  visible: true,
  ...over,
});

const t = (over: Partial<AttackTransform> = {}): AttackTransform => ({
  ...IDENTITY_ATTACK_TRANSFORM,
  ...over,
});

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);

describe("localScale", () => {
  it("is exact under a uniform scale, whichever way the member is turned", () => {
    for (const rotation of [0, 17, 45, 90, 213]) {
      expect(localScale(rotation, 3, 3)).toEqual({
        sx: 3,
        sy: 3,
        degraded: false,
      });
    }
  });

  it("is exact under a non-uniform scale while the member's axes line up with the attack's", () => {
    expect(localScale(0, 2, 3)).toEqual({ sx: 2, sy: 3, degraded: false });
    expect(localScale(180, 2, 3)).toEqual({ sx: 2, sy: 3, degraded: false });
    expect(localScale(-180, 2, 3)).toEqual({ sx: 2, sy: 3, degraded: false });
  });

  it("swaps the factors at a right angle, because the member's width lies along the attack's height", () => {
    expect(localScale(90, 2, 3)).toEqual({ sx: 3, sy: 2, degraded: false });
    expect(localScale(270, 2, 3)).toEqual({ sx: 3, sy: 2, degraded: false });
    expect(localScale(-90, 2, 3)).toEqual({ sx: 3, sy: 2, degraded: false });
  });

  it("falls back to uniform for a member a non-uniform scale would shear, so the shape survives even though the size doesn't", () => {
    const scaled = localScale(45, 2, 8);
    expect(scaled.degraded).toBe(true);
    expect(scaled.sx).toBe(scaled.sy);
    near(scaled.sx, 4); // √(2·8)
    expect(wouldDegrade(45, t({ sx: 2, sy: 8 }))).toBe(true);
    expect(wouldDegrade(45, t({ sx: 4, sy: 4 }))).toBe(false);
  });
});

describe("transformPoint", () => {
  const anchor = { x: 100, y: 100 };

  it("leaves everything alone under the identity", () => {
    expect(transformPoint({ x: 10, y: 20 }, anchor, t())).toEqual({
      x: 10,
      y: 20,
    });
  });

  it("holds the anchor still — it is what the placement turns and scales about", () => {
    const moved = transformPoint(
      anchor,
      anchor,
      t({ rotationDeg: 37, sx: 3, sy: 0.5 }),
    );
    near(moved.x, anchor.x);
    near(moved.y, anchor.y);
  });

  it("scales in the attack's own frame, then turns, then carries", () => {
    // (10,0) from the anchor, doubled in x → (20,0); turned 90° → (0,20).
    const moved = transformPoint(
      { x: 110, y: 100 },
      anchor,
      t({ rotationDeg: 90, sx: 2, sy: 1, tx: 5, ty: -5 }),
    );
    near(moved.x, 105);
    near(moved.y, 115);
  });
});

describe("transformDir", () => {
  it("leaves a direction alone under a uniform scale", () => {
    expect(transformDir(30, { sx: 4, sy: 4, degraded: false })).toBe(30);
  });

  it("leaves an absent direction absent", () => {
    expect(transformDir(undefined, { sx: 2, sy: 1, degraded: false })).toBe(
      undefined,
    );
  });

  it("re-measures a direction the scale squashed, which a box could not have expressed", () => {
    // 45° in a frame stretched 2x in x: the vector (1,1) becomes (2,1).
    const dir = transformDir(45, { sx: 2, sy: 1, degraded: false });
    near(dir!, (Math.atan2(1, 2) * 180) / Math.PI);
  });

  it("keeps the axes pointing where they did", () => {
    expect(transformDir(0, { sx: 2, sy: 5, degraded: false })).toBe(0);
    near(transformDir(90, { sx: 2, sy: 5, degraded: false })!, 90);
  });
});

describe("transformState", () => {
  const anchor = { x: 0, y: 0 };

  it("is a no-op under the identity", () => {
    const s = state({ x: 12, y: 34, rotation: 21 });
    const placed = transformState(s, anchor, t());
    near(placed.x, s.x);
    near(placed.y, s.y);
    expect(placed.w).toBe(s.w);
    expect(placed.h).toBe(s.h);
    expect(placed.rotation).toBe(s.rotation);
  });

  it("moves a member's centre exactly where the point maths says it goes", () => {
    const s = state({ x: 40, y: 60, rotation: 30 });
    const transform = t({ tx: 7, ty: -3, rotationDeg: 25, sx: 1.5, sy: 1.5 });
    const placed = transformState(s, anchor, transform);
    const expected = transformPoint(centrePoint(s), anchor, transform);
    near(centrePoint(placed).x, expected.x);
    near(centrePoint(placed).y, expected.y);
  });

  it("turns the member by the placement's rotation and scales its box", () => {
    const placed = transformState(
      state({ rotation: 10 }),
      anchor,
      t({ rotationDeg: 50, sx: 2, sy: 2 }),
    );
    expect(placed.rotation).toBe(60);
    expect(placed.w).toBe(200);
    expect(placed.h).toBe(100);
  });

  it("swaps a right-angled member's dimensions under a non-uniform scale", () => {
    const placed = transformState(
      state({ rotation: 90 }),
      anchor,
      t({ sx: 2, sy: 3 }),
    );
    expect(placed.w).toBe(300);
    expect(placed.h).toBe(100);
  });

  it("carries opacity and visibility through untouched — a placement is geometry, not presence", () => {
    const placed = transformState(
      state({ opacity: 0.25, visible: false }),
      anchor,
      t({ sx: 3, sy: 3, rotationDeg: 90 }),
    );
    expect(placed.opacity).toBe(0.25);
    expect(placed.visible).toBe(false);
  });
});

describe("attackAnchor", () => {
  it("is the middle of the whole extent, not the average of the members' centres", () => {
    // One small box at the far left and two stacked at the right: a centroid of
    // centres would sit right of middle; the extent's middle does not.
    const anchor = attackAnchor({
      a: state({ x: 0, y: 0, w: 100, h: 100 }),
      b: state({ x: 300, y: 0, w: 100, h: 100 }),
      c: state({ x: 300, y: 0, w: 100, h: 100 }),
    });
    expect(anchor).toEqual({ x: 200, y: 50 });
  });

  it("accounts for rotation, so a turned member's reach still counts", () => {
    const anchor = attackAnchor({
      a: state({ x: 0, y: 0, w: 100, h: 0, rotation: 90 }),
    });
    near(anchor.x, 0);
    near(anchor.y, 50);
  });

  it("falls back to the origin for a definition with nothing on its slide", () => {
    expect(attackAnchor({})).toEqual({ x: 0, y: 0 });
  });
});

describe("placementTransform", () => {
  const anchor = { x: 50, y: 50 };

  it("lands the aligned point exactly on the drop point, under any rotation and scale", () => {
    const align = { x: 10, y: 90 };
    const at = { x: 640, y: 360 };
    for (const spin of [
      { rotationDeg: 0, sx: 1, sy: 1 },
      { rotationDeg: 90, sx: 2, sy: 2 },
      { rotationDeg: -37, sx: 0.5, sy: 3 },
    ]) {
      const transform = placementTransform({ anchor, align, at, ...spin });
      const landed = transformPoint(align, anchor, transform);
      near(landed.x, at.x);
      near(landed.y, at.y);
    }
  });
});
