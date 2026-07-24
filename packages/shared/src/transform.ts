import { z } from "zod";

/**
 * A 2D transform in the background's **native pixel space** (see plan §5,
 * "Coordinate system"). All positions are resolution-independent; the Konva
 * Stage is scaled to fit the container at render time.
 */
export const TransformSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  /** Width in native pixels. Non-negative; zero is allowed for degenerate/hidden nodes. */
  w: z.number().finite().nonnegative(),
  /** Height in native pixels. */
  h: z.number().finite().nonnegative(),
  /** Rotation in degrees (Konva convention), clockwise. */
  rotation: z.number().finite(),
  /**
   * The **origin**: the point this transform turns about and hangs from, as a
   * fraction of its own box — `0.5, 0.5` is the middle, `0, 0` the top-left
   * (plan §18.17).
   *
   * A fraction rather than a pixel offset because it has to survive resizing:
   * drag a Transformer handle, or map a definition out of unit space onto a
   * placed rectangle, and a fraction comes through unchanged while an offset
   * would need rescaling at every step that touches the box.
   *
   * Deliberately **not** clamped to 0..1. A cone's apex is often off the drawn
   * shape and a beam starts behind itself, so an origin outside the box is a
   * normal thing to want, not a mistake to reject.
   *
   * Absent means centred, which is where an object with no opinion turns and is
   * where everything turned before origins existed — so a saved plan carries
   * these only for the objects that actually moved one.
   */
  ox: z.number().finite().optional(),
  oy: z.number().finite().optional(),
  /**
   * Which way this transform **points**, in degrees clockwise from +x, measured
   * in its own unrotated frame. Absent means 0 — pointing right.
   *
   * An angle rather than a second point, because a point would be dragged out
   * of true by any non-square scaling: unit space maps x and y independently
   * ({@link ../attack.ts mapPoint}), so stretching a frontal sideways would
   * quietly re-aim it. An angle is immune to that.
   */
  dir: z.number().finite().optional(),
});

export type Transform = z.infer<typeof TransformSchema>;

/** A single point in native pixel space (used for motion paths). */
export const PointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export type Point = z.infer<typeof PointSchema>;

/** A box with no extent can't have a fraction taken of it without dividing by zero. */
const MIN_EXTENT = 1e-6;

const DEG = Math.PI / 180;

/** Just the parts of a transform the origin maths needs. */
export type Pivoted = Pick<Transform, "x" | "y" | "w" | "h" | "rotation"> &
  Partial<Pick<Transform, "ox" | "oy" | "dir">>;

/** Direction from `a` to `b`, in degrees (Konva's y-down, so clockwise). */
export const angleDeg = (a: Point, b: Point): number =>
  Math.atan2(b.y - a.y, b.x - a.x) / DEG;

/**
 * Where the origin actually sits, in the space the transform is placed in.
 *
 * Rotation is about `x,y` — the top-left — which is Konva's convention and the
 * one the rest of the geometry already assumes (see `cornersOf` in
 * `attack.ts`). So the origin is the local offset, turned by the transform's own
 * rotation, added to the top-left.
 */
export function pivotPoint(t: Pivoted): Point {
  const rad = t.rotation * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (t.ox ?? 0.5) * t.w;
  const dy = (t.oy ?? 0.5) * t.h;
  return { x: t.x + dx * cos - dy * sin, y: t.y + dx * sin + dy * cos };
}

/** Which way the transform points *in the world*: its own facing, turned by it. */
export const facingDeg = (t: Pivoted): number => t.rotation + (t.dir ?? 0);

/**
 * The origin, recovered from a point in the parent's space — the inverse of
 * {@link pivotPoint}, for dragging the handle.
 */
export function pivotFraction(
  t: Pivoted,
  p: Point,
): { ox: number; oy: number } {
  const rad = -t.rotation * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  return {
    ox: (dx * cos - dy * sin) / Math.max(t.w, MIN_EXTENT),
    oy: (dx * sin + dy * cos) / Math.max(t.h, MIN_EXTENT),
  };
}

/**
 * Turn a transform about its own origin, leaving that origin exactly where it
 * was.
 *
 * Returned as a new `x/y/rotation` rather than as an offset the renderers would
 * have to honour: the document keeps saying *top-left plus degrees*, so every
 * renderer, exporter and hit-test carries on reading the same three numbers and
 * nothing downstream needs to learn about origins at all.
 *
 * Exact in one pass, because the origin is the fixed point of its own rotation —
 * there is nothing to iterate towards.
 */
export function rotateAboutPivot<T extends Pivoted>(t: T, deltaDeg: number): T {
  const pivot = pivotPoint(t);
  const rotation = t.rotation + deltaDeg;
  const rad = rotation * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (t.ox ?? 0.5) * t.w;
  const dy = (t.oy ?? 0.5) * t.h;
  return {
    ...t,
    x: pivot.x - (dx * cos - dy * sin),
    y: pivot.y - (dx * sin + dy * cos),
    rotation,
  };
}

/** Turn a transform so it points at `target`, pivoting about its own origin. */
export function aimAt<T extends Pivoted>(t: T, target: Point): T {
  return rotateAboutPivot(t, angleDeg(pivotPoint(t), target) - facingDeg(t));
}

/** Move a transform bodily so its origin lands on `at`. Never turns it. */
export function pinTo<T extends Pivoted>(t: T, at: Point): T {
  const pivot = pivotPoint(t);
  return { ...t, x: t.x + (at.x - pivot.x), y: t.y + (at.y - pivot.y) };
}

/**
 * Drag the origin handle of a **pinned** object to `pointer`, without letting
 * the origin leave the attach point (plan §18.17).
 *
 * When a thing's origin is welded to another object, chasing the crosshair with
 * the cursor would tear the origin off the attach point and strand it in space.
 * So the handle stays put and the *body slides the opposite way* instead: grab
 * the origin, pull right, and the object walks left out from under a fixed pin.
 *
 * Returned as a new `x/y` plus the `ox/oy` that keep the origin exactly where it
 * was — {@link pivotPoint} of the result is the same point it started on, so a
 * re-pin the next frame is a no-op and the crosshair never jumps. The box moves
 * by the pointer's offset from that origin, negated; the fraction is read off
 * the pointer, which is why it equals a plain {@link pivotFraction} of `pointer`
 * (translating the box by that same offset cancels out of the maths).
 */
export function slidePinnedOrigin(
  t: Pivoted,
  pointer: Point,
): { x: number; y: number; ox: number; oy: number } {
  const anchor = pivotPoint(t);
  const { ox, oy } = pivotFraction(t, pointer);
  return {
    x: t.x - (pointer.x - anchor.x),
    y: t.y - (pointer.y - anchor.y),
    ox,
    oy,
  };
}
