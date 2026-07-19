import { describe, expect, it } from "vitest";
import type { Anim } from "@raidplan/shared";
import type { Rect } from "../editor/canvas/marquee";
import {
  collidingAnimIds,
  collisionRules,
  isColliding,
  type RectLookup,
} from "./collision";

function anim(over: Partial<Anim> = {}): Anim {
  return {
    id: "anim_1",
    objectId: "orb",
    kind: "exit",
    effect: "disappear",
    trigger: "onCollision",
    delayMs: 0,
    durationMs: 300,
    easing: "none",
    ...over,
  };
}

const box = (x: number, y: number, size = 50): Rect => ({
  x,
  y,
  width: size,
  height: size,
});

/** Build a lookup from a plain map; unknown ids are "not on the stage". */
const lookup =
  (rects: Record<string, Rect>): RectLookup =>
  (id) =>
    rects[id] ?? null;

describe("collisionRules", () => {
  it("picks up only onCollision animations that name a collider", () => {
    const rules = collisionRules([
      anim({ id: "armed", collideWith: ["tank"] }),
      anim({ id: "no-colliders", collideWith: [] }),
      anim({ id: "absent-colliders", collideWith: undefined }),
      anim({ id: "timed", trigger: "onEnter", collideWith: ["tank"] }),
    ]);
    expect(rules.map((r) => r.animId)).toEqual(["armed"]);
    expect(rules[0]).toMatchObject({ objectId: "orb", collideWith: ["tank"] });
  });

  it("never lets an object collide with itself", () => {
    // Otherwise it would fire on the very first frame.
    const rules = collisionRules([
      anim({ id: "self", objectId: "orb", collideWith: ["orb"] }),
      anim({ id: "mixed", objectId: "orb", collideWith: ["orb", "tank"] }),
    ]);
    expect(rules.map((r) => r.animId)).toEqual(["mixed"]);
    expect(rules[0]!.collideWith).toEqual(["tank"]);
  });
});

describe("isColliding", () => {
  const rule = {
    animId: "a",
    objectId: "orb",
    collideWith: ["tank", "healer"],
  };

  it("detects an overlap with any collider", () => {
    expect(
      isColliding(rule, lookup({ orb: box(0, 0), tank: box(25, 25) })),
    ).toBe(true);
  });

  it("is false while everything is apart", () => {
    expect(
      isColliding(rule, lookup({ orb: box(0, 0), tank: box(500, 500) })),
    ).toBe(false);
  });

  it("fires when only one of several colliders overlaps", () => {
    const rects = { orb: box(0, 0), tank: box(900, 900), healer: box(10, 10) };
    expect(isColliding(rule, lookup(rects))).toBe(true);
  });

  it("counts touching edges as a collision (matches the marquee)", () => {
    expect(
      isColliding(rule, lookup({ orb: box(0, 0), tank: box(50, 0) })),
    ).toBe(true);
  });

  it("tolerates objects that aren't on the stage", () => {
    // e.g. the collider was deleted, or hasn't mounted yet.
    expect(isColliding(rule, lookup({ orb: box(0, 0) }))).toBe(false);
    expect(isColliding(rule, lookup({ tank: box(0, 0) }))).toBe(false);
    expect(isColliding(rule, () => null)).toBe(false);
  });
});

describe("collidingAnimIds", () => {
  it("returns just the rules that are currently touching", () => {
    const rules = [
      { animId: "hit", objectId: "orb", collideWith: ["tank"] },
      { animId: "miss", objectId: "orb2", collideWith: ["tank"] },
    ];
    const rects = { orb: box(0, 0), orb2: box(800, 800), tank: box(20, 20) };
    expect(collidingAnimIds(rules, lookup(rects))).toEqual(["hit"]);
  });

  it("is empty when nothing is armed", () => {
    expect(collidingAnimIds([], () => null)).toEqual([]);
  });
});
