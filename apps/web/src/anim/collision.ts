import type { Anim } from "@raidplan/shared";
import { rectsIntersect, type Rect } from "../editor/canvas/marquee";

/**
 * Collision detection for `onCollision` animations (plan §7).
 *
 * **Axis-aligned bounding boxes**, the same technique Konva's own collision
 * sandbox uses — and the same `rectsIntersect` the marquee already relies on,
 * so there is exactly one AABB implementation in the codebase. Boxes come from
 * `getClientRect()` on the live Konva nodes, which is what makes this work
 * mid-animation: during playback GSAP writes straight to those nodes.
 *
 * Everything here is pure. The caller supplies a `rectOf` lookup, so the maths
 * is unit-testable with plain rectangles — no canvas, no stage.
 */

/** One armed collision: "when `objectId` overlaps any of `collideWith`, fire `animId`". */
export interface CollisionRule {
  animId: string;
  objectId: string;
  collideWith: string[];
}

/** Look up an object's current bounding box; `null` if it isn't on the stage. */
export type RectLookup = (objectId: string) => Rect | null;

/**
 * The armed rules in a step. Only `onCollision` animations that actually name a
 * collider qualify — one with an empty `collideWith` can never fire, so it's
 * dropped here rather than checked 60 times a second.
 */
export function collisionRules(animations: readonly Anim[]): CollisionRule[] {
  const rules: CollisionRule[] = [];
  for (const anim of animations) {
    if (anim.trigger !== "onCollision") continue;
    // An object can't collide with itself — that would fire on frame one.
    const collideWith = (anim.collideWith ?? []).filter(
      (id) => id !== anim.objectId,
    );
    if (collideWith.length === 0) continue;
    rules.push({ animId: anim.id, objectId: anim.objectId, collideWith });
  }
  return rules;
}

/** Is this rule's object currently overlapping any of its colliders? */
export function isColliding(rule: CollisionRule, rectOf: RectLookup): boolean {
  const target = rectOf(rule.objectId);
  if (!target) return false;
  return rule.collideWith.some((id) => {
    const other = rectOf(id);
    return other !== null && rectsIntersect(target, other);
  });
}

/**
 * The ids of the animations whose collision is happening right now. The caller
 * decides what to do about repeats — playback fires each at most once per
 * playthrough, so a pickup is consumed rather than retriggering every frame.
 */
export function collidingAnimIds(
  rules: readonly CollisionRule[],
  rectOf: RectLookup,
): string[] {
  return rules.filter((rule) => isColliding(rule, rectOf)).map((r) => r.animId);
}
