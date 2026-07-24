import { describe, expect, it } from "vitest";
import {
  aimAt,
  angleDeg,
  facingDeg,
  pinTo,
  pivotFraction,
  pivotPoint,
  rotateAboutPivot,
  slidePinnedOrigin,
  type Pivoted,
} from "../src/transform.js";

/** A 100×40 box at the origin, unrotated. */
const box = (patch: Partial<Pivoted> = {}): Pivoted => ({
  x: 0,
  y: 0,
  w: 100,
  h: 40,
  rotation: 0,
  ...patch,
});

const near = (a: number, b: number, digits = 9) =>
  expect(a).toBeCloseTo(b, digits);

describe("pivotPoint", () => {
  it("is the middle of the box when nothing says otherwise", () => {
    expect(pivotPoint(box())).toEqual({ x: 50, y: 20 });
  });

  it("reads ox/oy as fractions of width and height", () => {
    expect(pivotPoint(box({ ox: 0, oy: 0 }))).toEqual({ x: 0, y: 0 });
    expect(pivotPoint(box({ ox: 1, oy: 1 }))).toEqual({ x: 100, y: 40 });
  });

  it("allows an origin outside the box — a cone's apex is off its shape", () => {
    expect(pivotPoint(box({ ox: -0.5, oy: 0.5 }))).toEqual({ x: -50, y: 20 });
  });

  it("turns the local offset by the transform's own rotation", () => {
    // Quarter turn clockwise: the point 100 to the right lands 100 below.
    const p = pivotPoint(box({ ox: 1, oy: 0, rotation: 90 }));
    near(p.x, 0);
    near(p.y, 100);
  });

  it("round-trips through pivotFraction", () => {
    const t = box({ ox: 0.25, oy: 0.75, rotation: 37, x: 12, y: -8 });
    const back = pivotFraction(t, pivotPoint(t));
    near(back.ox, 0.25);
    near(back.oy, 0.75);
  });
});

describe("rotateAboutPivot", () => {
  it("leaves the origin exactly where it was", () => {
    for (const [ox, oy] of [
      [0.5, 0.5],
      [0, 0],
      [1, 0.25],
      [-0.4, 1.8],
    ] as const) {
      const t = box({ ox, oy, x: 30, y: -15, rotation: 20 });
      const before = pivotPoint(t);
      const after = pivotPoint(rotateAboutPivot(t, 73));
      near(after.x, before.x);
      near(after.y, before.y);
    }
  });

  it("adds the delta to the rotation and keeps the size", () => {
    const turned = rotateAboutPivot(box({ rotation: 10 }), 35);
    expect(turned.rotation).toBe(45);
    expect(turned.w).toBe(100);
    expect(turned.h).toBe(40);
  });

  it("is exact in one pass — turning back returns the same transform", () => {
    const t = box({ ox: 0.1, oy: 0.9, x: 5, y: 7, rotation: 12 });
    const back = rotateAboutPivot(rotateAboutPivot(t, 100), -100);
    near(back.x, t.x);
    near(back.y, t.y);
    near(back.rotation, t.rotation);
  });

  it("moves x/y for an off-centre origin, and not for a centred one", () => {
    const centred = rotateAboutPivot(box(), 90);
    // A 100×40 box turned about its middle: the top-left swings round.
    near(centred.x, 70);
    near(centred.y, -30);

    // With the origin *on* the top-left, x/y are the fixed point.
    const corner = rotateAboutPivot(box({ ox: 0, oy: 0 }), 90);
    near(corner.x, 0);
    near(corner.y, 0);
  });
});

describe("facing", () => {
  it("is the transform's own rotation plus its local direction", () => {
    expect(facingDeg(box({ rotation: 30, dir: 15 }))).toBe(45);
    expect(facingDeg(box({ rotation: 30 }))).toBe(30);
  });

  it("aimAt points the facing at the target, about the origin", () => {
    const t = box({ ox: 0, oy: 0.5, dir: 0 });
    const target = { x: 0, y: 200 };
    const aimed = aimAt(t, target);
    // Straight down is +90° in Konva's y-down, clockwise world.
    near(facingDeg(aimed), 90);
    // And the origin has not moved.
    const before = pivotPoint(t);
    const after = pivotPoint(aimed);
    near(after.x, before.x);
    near(after.y, before.y);
  });

  it("aims correctly when the shape was drawn pointing somewhere else", () => {
    // Drawn pointing up (-90) — aiming right must land on rotation +90.
    const t = box({ ox: 0.5, oy: 0.5, dir: -90 });
    const aimed = aimAt(t, { x: 500, y: 20 });
    near(facingDeg(aimed), 0);
    near(aimed.rotation, 90);
  });

  it("a non-square stretch leaves the direction alone", () => {
    // The regression the old two-placeholder anchor had: a facing derived from
    // a second *point* skewed when unit space scaled x and y independently.
    const narrow = box({ w: 100, h: 40, dir: 30 });
    const wide = box({ w: 400, h: 40, dir: 30 });
    expect(facingDeg(wide)).toBe(facingDeg(narrow));
  });
});

describe("pinTo", () => {
  it("moves the origin onto the point without turning anything", () => {
    const t = box({ ox: 0.25, oy: 0.5, rotation: 42 });
    const moved = pinTo(t, { x: 300, y: -100 });
    expect(moved.rotation).toBe(42);
    const p = pivotPoint(moved);
    near(p.x, 300);
    near(p.y, -100);
  });
});

describe("slidePinnedOrigin", () => {
  it("leaves the origin exactly on the attach point", () => {
    // Whatever the pointer does, the origin must not budge — that is the whole
    // point of a pinned object.
    for (const t of [
      box({ ox: 0.5, oy: 0.5, x: 30, y: -15 }),
      box({ ox: 0, oy: 1, x: 5, y: 7, rotation: 25 }),
      box({ ox: -0.3, oy: 0.4, x: -40, y: 60, rotation: -80 }),
    ]) {
      const before = pivotPoint(t);
      for (const pointer of [{ x: 200, y: 90 }, { x: -50, y: -120 }, before]) {
        const after = pivotPoint({ ...t, ...slidePinnedOrigin(t, pointer) });
        near(after.x, before.x);
        near(after.y, before.y);
      }
    }
  });

  it("slides the body the opposite way to the pointer's pull", () => {
    const t = box({ ox: 0.5, oy: 0.5 }); // origin at (50, 20)
    // Pull the handle 30 right and 10 down of the origin…
    const slid = slidePinnedOrigin(t, { x: 80, y: 30 });
    // …and the box walks 30 left and 10 up out from under it.
    near(slid.x, -30);
    near(slid.y, -10);
  });

  it("is a no-op when the pointer is already on the origin", () => {
    const t = box({ ox: 0.25, oy: 0.75, x: 12, y: -8, rotation: 37 });
    const slid = slidePinnedOrigin(t, pivotPoint(t));
    near(slid.x, t.x);
    near(slid.y, t.y);
    near(slid.ox, 0.25);
    near(slid.oy, 0.75);
  });

  it("reads the new fraction straight off the pointer", () => {
    // The returned ox/oy are where the pointer lands in the box, so the crosshair
    // the planner sees follows the same maths the free-origin drag uses.
    const t = box({ ox: 0.5, oy: 0.5, x: 40, y: 40, rotation: 18 });
    const pointer = { x: 130, y: 5 };
    const slid = slidePinnedOrigin(t, pointer);
    const fraction = pivotFraction(t, pointer);
    near(slid.ox, fraction.ox);
    near(slid.oy, fraction.oy);
  });
});

describe("angleDeg", () => {
  it("is clockwise from +x, matching Konva's y-down space", () => {
    expect(angleDeg({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(angleDeg({ x: 0, y: 0 }, { x: -1, y: 0 })).toBe(180);
  });
});
