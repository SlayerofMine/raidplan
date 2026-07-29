import type { AttackTransform } from "./attack.js";
import type { SlideState } from "./plan.js";
import { centrePoint, topLeftForCentre, type Point } from "./transform.js";

/**
 * How a placement moves an attack's authored geometry (plan §21).
 *
 * The transform is **translate ∘ rotate ∘ scale** about the definition's anchor:
 * scale in the attack's own frame first, then turn the whole thing, then carry
 * it to where it was dropped. Pure, so the same maths runs in the stamp, the
 * designer's lint and the tests.
 *
 * **Exact where the schema can hold the result, and degraded rather than wrong
 * where it can't.** A `SlideState` is a box with one rotation: it can say "64
 * wide, 32 tall, turned 30°", and it cannot say "a parallelogram". A non-uniform
 * scale applied to a member that is itself turned to an odd angle produces
 * exactly that parallelogram, so for that member alone the scale falls back to
 * uniform `√(sx·sy)` — the size is not what was asked for, but the shape is
 * still the shape that was authored. §20 records what happens when geometry is
 * instead squeezed into a model that cannot express it: the error does not stay
 * put, it compounds on every save.
 *
 * Three quantities need separate treatment, and each is exact:
 *
 *  - **Centres** move by the full transform, always. Positions are the one thing
 *    a rigid motion never damages.
 *  - **Sizes** scale in the member's own frame, with the axes swapped when it
 *    stands at a right angle to the attack — a box turned 90° has its width
 *    along the attack's y.
 *  - **Directions** (`dir`) are angles, not shapes: scaling the unit vector they
 *    name and re-measuring it is exactly right, and representable, even when the
 *    box they belong to would have sheared.
 *
 * `ox`/`oy` need no treatment at all: they are fractions of the member's own
 * box, and scaling that box along its own axes leaves a fraction of it alone.
 */

const DEG = Math.PI / 180;

/** The scale factors that actually apply in one member's own frame. */
export interface LocalScale {
  sx: number;
  sy: number;
  /**
   * True when the member is turned to an angle a non-uniform scale would shear,
   * so it was scaled uniformly instead. The designer's lint reads this.
   */
  degraded: boolean;
}

/**
 * The scale a member of the given rotation actually receives.
 *
 * A uniform scale is exact for any rotation — a circle stretched equally is
 * still a circle, whichever way up. A non-uniform one is exact only while the
 * member's own axes line up with the attack's, which is every multiple of 90°;
 * at a right angle the two factors swap, because the member's width lies along
 * the attack's height.
 */
export function localScale(
  rotationDeg: number,
  sx: number,
  sy: number,
): LocalScale {
  if (sx === sy) return { sx, sy, degraded: false };
  const turn = ((rotationDeg % 360) + 360) % 360;
  if (turn === 0 || turn === 180) return { sx, sy, degraded: false };
  if (turn === 90 || turn === 270) return { sx: sy, sy: sx, degraded: false };
  const uniform = Math.sqrt(sx * sy);
  return { sx: uniform, sy: uniform, degraded: true };
}

/** Whether this placement would shear a member turned to `rotationDeg`. */
export const wouldDegrade = (
  rotationDeg: number,
  transform: AttackTransform,
): boolean => localScale(rotationDeg, transform.sx, transform.sy).degraded;

/** A point of the attack's authored space, moved to where the placement puts it. */
export function transformPoint(
  point: Point,
  anchor: Point,
  t: AttackTransform,
): Point {
  const dx = (point.x - anchor.x) * t.sx;
  const dy = (point.y - anchor.y) * t.sy;
  const rad = t.rotationDeg * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: anchor.x + t.tx + dx * cos - dy * sin,
    y: anchor.y + t.ty + dx * sin + dy * cos,
  };
}

/**
 * A direction, re-measured after the scale that squashed the frame it points in.
 *
 * `dir` names a unit vector in the member's unrotated frame; scaling that frame
 * turns `(cos d, sin d)` into `(cos d · sx, sin d · sy)`, and the angle of the
 * result is the new direction. Exact, and always representable — which is why a
 * frontal keeps pointing where it was aimed even when its box had to give up a
 * non-uniform scale.
 */
export function transformDir(
  dir: number | undefined,
  local: LocalScale,
): number | undefined {
  if (dir === undefined) return undefined;
  if (local.sx === local.sy) return dir;
  const rad = dir * DEG;
  return Math.atan2(Math.sin(rad) * local.sy, Math.cos(rad) * local.sx) / DEG;
}

/**
 * One member's authored state, moved to where the placement puts it.
 *
 * Works in **centre space**: rotation is about the top-left, so a turned box's
 * centre is not `x + w/2` and translating the stored corner would swing the
 * member off its mark. The centre is transformed, the box is resized and turned,
 * and the corner is recovered from the result.
 */
export function transformState(
  state: SlideState,
  anchor: Point,
  t: AttackTransform,
): SlideState {
  const local = localScale(state.rotation, t.sx, t.sy);
  const w = state.w * local.sx;
  const h = state.h * local.sy;
  const rotation = state.rotation + t.rotationDeg;
  const centre = transformPoint(centrePoint(state), anchor, t);
  const { x, y } = topLeftForCentre({ x: 0, y: 0, w, h, rotation }, centre);
  return { ...state, x, y, w, h, rotation };
}

/**
 * The transform that puts `align` — a point of the attack's authored space — on
 * `at`, under the given rotation and scale.
 *
 * Translation is applied last and additively, so this is one subtraction rather
 * than anything iterative: rotate and scale about the anchor with no
 * translation, see where the point landed, and carry it the rest of the way.
 *
 * `align` is the slot's authored centre when the attack has one — which is what
 * makes "place it on this token" exact — and the anchor itself when it has none,
 * which centres the attack on the cursor.
 */
export function placementTransform(params: {
  anchor: Point;
  align: Point;
  at: Point;
  rotationDeg?: number;
  sx?: number;
  sy?: number;
}): AttackTransform {
  const spun: AttackTransform = {
    tx: 0,
    ty: 0,
    rotationDeg: params.rotationDeg ?? 0,
    sx: params.sx ?? 1,
    sy: params.sy ?? 1,
  };
  const landed = transformPoint(params.align, params.anchor, spun);
  return { ...spun, tx: params.at.x - landed.x, ty: params.at.y - landed.y };
}

/** The four corners of a placed box, in the space it sits in. */
function corners(state: SlideState): Point[] {
  const rad = state.rotation * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [0, 0],
    [state.w, 0],
    [state.w, state.h],
    [0, state.h],
  ].map(([dx, dy]) => ({
    x: state.x + dx! * cos - dy! * sin,
    y: state.y + dx! * sin + dy! * cos,
  }));
}

/**
 * The point a placement turns and scales about: the middle of everything the
 * attack draws.
 *
 * The middle of the whole *extent*, not the average of the members' centres, so
 * dropping an attack puts what you can see under the cursor rather than putting
 * its busiest corner there. Falls back to the origin for a definition with
 * nothing on its slide, which has no geometry to have a middle of.
 */
export function attackAnchor(states: Record<string, SlideState>): Point {
  const points = Object.values(states).flatMap(corners);
  const first = points[0];
  if (!first) return { x: 0, y: 0 };
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
