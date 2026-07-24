import { z } from "zod";
import {
  aimAt,
  pinTo,
  pivotPoint,
  type Pivoted,
  type Point,
} from "./transform.js";

/**
 * Following: things that keep up with other things (plan §18.17).
 *
 * A follow says what a transform's own {@link ../transform.js origin and
 * direction} are *attached to*: `pin` puts the origin on another object, `aim`
 * turns the direction towards one. A frontal from the boss at a tank is
 * `{ pin: boss, aim: tank }` — and that is the whole of it.
 *
 * This one idea replaced three (§18.15's `anchor.originId`/`facingId` and
 * §18.16's `lookAts`). They were the same geometry said three ways, and each
 * needed the author to conjure a *second object* to stand for what is really a
 * point and an angle. With the origin and direction on the transform itself,
 * what's left to say is only who they follow.
 *
 * Ids are read in the **expanded** plan's namespace, which is what lets one
 * field cover every case: a plan object following another plan object, a
 * definition's part following another part of the same attack, and a definition
 * following one of the *plan's* objects through a placeholder. `expandPlan`
 * routes them through the same `resolveId` choke point as tether ends and
 * collision targets, so a filled placeholder resolves to the plan's own id and
 * every reference follows at once.
 */
export const FollowSchema = z.object({
  /** The object whose centre this transform's origin sits on. */
  pin: z.string().min(1).optional(),
  /** The object this transform's direction points at. */
  aim: z.string().min(1).optional(),
});

export type Follow = z.infer<typeof FollowSchema>;

/** True when a follow actually says something — an empty one is as good as none. */
export const isFollowing = (follow: Follow | undefined): boolean =>
  Boolean(follow?.pin || follow?.aim);

/**
 * Rewrite a follow's ids through an id mapping — how a definition's local names
 * become the expanded plan's, exactly as tether ends and collision targets do.
 */
export const resolveFollow = (
  follow: Follow | undefined,
  resolveId: (id: string) => string,
): Follow => ({
  ...(follow?.pin ? { pin: resolveId(follow.pin) } : {}),
  ...(follow?.aim ? { aim: resolveId(follow.aim) } : {}),
});

/**
 * Where a bound transform belongs, given where the things it follows are *right
 * now*.
 *
 * Pure, and deliberately so: the same maths runs in the editor's canvas, the
 * viewer's frame loop and the tests, from nothing but a transform and two
 * points. Returns `null` when nothing is bound, or when what it follows isn't on
 * the board — which means "leave the placement alone", so a plan with a broken
 * reference still draws where it was put rather than collapsing to the corner.
 *
 * **Pin first, then aim**, and the order is not a detail: aiming means "point at
 * the tank *from where I stand*", so it has to be asked after the pin has said
 * where that is. Do it the other way round and a frontal pinned to the boss
 * keeps the angle it had from wherever it used to sit. Aiming then turns about
 * the origin, which the pin has just placed and which its own rotation cannot
 * move — so the pin survives it and one pass settles both.
 *
 * Size is never touched: a frontal's reach is the ability's, not the distance to
 * whoever it is aimed at.
 */
export function solveFollow<T extends Pivoted>(
  t: T,
  follow: Follow | undefined,
  centreOf: (id: string) => Point | null,
): { x: number; y: number; rotation: number } | null {
  if (!isFollowing(follow)) return null;

  let next = t;
  let touched = false;

  const pin = follow?.pin ? centreOf(follow.pin) : null;
  if (pin) {
    next = pinTo(next, pin);
    touched = true;
  }

  const aim = follow?.aim ? centreOf(follow.aim) : null;
  if (aim) {
    // Aiming at the point you already stand on has no answer; keep the rotation.
    const from = pivotPoint(next);
    if (from.x !== aim.x || from.y !== aim.y) {
      next = aimAt(next, aim);
      touched = true;
    }
  }

  return touched ? { x: next.x, y: next.y, rotation: next.rotation } : null;
}
