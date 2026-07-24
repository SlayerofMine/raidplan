import { describe, expect, it } from "vitest";
import {
  isFollowing,
  resolveFollow,
  solveFollow,
  type Follow,
} from "../src/follow.js";
import {
  facingDeg,
  pivotPoint,
  type Pivoted,
  type Point,
} from "../src/transform.js";

/** A 200×80 cone, cast from the middle of its left edge, pointing right. */
const cone = (patch: Partial<Pivoted> = {}): Pivoted => ({
  x: 0,
  y: 0,
  w: 200,
  h: 80,
  rotation: 0,
  ox: 0,
  oy: 0.5,
  dir: 0,
  ...patch,
});

const board = (points: Record<string, Point>) => (id: string) =>
  points[id] ?? null;

const near = (a: number, b: number, digits = 9) =>
  expect(a).toBeCloseTo(b, digits);

describe("isFollowing", () => {
  it("is false for nothing, and for a follow that says nothing", () => {
    expect(isFollowing(undefined)).toBe(false);
    expect(isFollowing({})).toBe(false);
    expect(isFollowing({ pin: "boss" })).toBe(true);
    expect(isFollowing({ aim: "tank" })).toBe(true);
  });
});

describe("solveFollow", () => {
  it("returns null when nothing is bound — leave the placement alone", () => {
    expect(solveFollow(cone(), undefined, board({}))).toBeNull();
    expect(solveFollow(cone(), {}, board({}))).toBeNull();
  });

  it("returns null when what it follows isn't on the board", () => {
    const follow: Follow = { pin: "boss", aim: "tank" };
    expect(solveFollow(cone(), follow, board({}))).toBeNull();
  });

  it("pins the origin onto the pinned object's centre", () => {
    const placed = solveFollow(
      cone(),
      { pin: "boss" },
      board({ boss: { x: 500, y: 300 } }),
    )!;
    expect(placed.rotation).toBe(0);
    // The origin is the left edge's middle, so the box hangs off to the right.
    near(placed.x, 500);
    near(placed.y, 260);
  });

  it("aims without moving the origin", () => {
    const t = cone();
    const before = pivotPoint(t);
    const placed = solveFollow(
      t,
      { aim: "tank" },
      board({ tank: { x: 0, y: 400 } }),
    )!;
    const after = pivotPoint({ ...t, ...placed });
    near(after.x, before.x);
    near(after.y, before.y);
    near(placed.rotation, 90);
  });

  it("pins and aims at once — a frontal from the boss at the tank", () => {
    const t = cone();
    const placed = solveFollow(
      t,
      { pin: "boss", aim: "tank" },
      board({ boss: { x: 100, y: 100 }, tank: { x: 100, y: 900 } }),
    )!;
    const solved = { ...t, ...placed };
    // Cast from the boss...
    const origin = pivotPoint(solved);
    near(origin.x, 100);
    near(origin.y, 100);
    // ...pointing at the tank, which is straight down.
    near(facingDeg(solved), 90);
  });

  it("keeps the attack's own size — reach is the ability's, not the distance", () => {
    const t = cone();
    const placed = solveFollow(
      t,
      { pin: "boss", aim: "tank" },
      board({ boss: { x: 0, y: 0 }, tank: { x: 10000, y: 0 } }),
    )!;
    expect(Object.keys(placed).sort()).toEqual(["rotation", "x", "y"]);
  });

  it("holds the angle a part was drawn at, whatever that was", () => {
    // An indicator drawn pointing up at its orb keeps pointing at the orb.
    const indicator = cone({ dir: -90, ox: 0.5, oy: 0.5 });
    const placed = solveFollow(
      indicator,
      { aim: "orb" },
      board({ orb: { x: 100, y: -500 } }),
    )!;
    near(facingDeg({ ...indicator, ...placed }), -90);
  });

  it("ignores an aim at the point the origin already stands on", () => {
    // atan2(0, 0) has no meaningful answer; the rotation must not become NaN.
    const t = cone({ ox: 0.5, oy: 0.5, rotation: 33 });
    const centre = pivotPoint(t);
    const placed = solveFollow(t, { aim: "self" }, board({ self: centre }));
    expect(placed).toBeNull();
  });

  it("a pin still applies when the aim target is missing", () => {
    const placed = solveFollow(
      cone({ rotation: 17 }),
      { pin: "boss", aim: "gone" },
      board({ boss: { x: 40, y: 60 } }),
    )!;
    expect(placed.rotation).toBe(17);
    near(pivotPoint({ ...cone({ rotation: 17 }), ...placed }).x, 40);
  });
});

describe("resolveFollow", () => {
  it("rewrites both ids through the mapping", () => {
    const mapped = resolveFollow({ pin: "slot", aim: "orb" }, (id) =>
      id === "slot" ? "plan-boss" : `attack::${id}`,
    );
    expect(mapped).toEqual({ pin: "plan-boss", aim: "attack::orb" });
  });

  it("leaves out what was never there", () => {
    expect(resolveFollow({ aim: "orb" }, (id) => id)).toEqual({ aim: "orb" });
    expect(resolveFollow(undefined, (id) => id)).toEqual({});
  });
});
