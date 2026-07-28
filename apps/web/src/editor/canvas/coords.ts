import { rotateAboutPivot, type Pivoted } from "@raidplan/shared";

/**
 * Pure coordinate math for the canvas (plan §6 "Pan & zoom", §1.2 acceptance).
 *
 * The Konva `Stage` is transformed by a {@link View}: every object is stored in
 * the background's **native pixel space**, and the stage applies a uniform
 * `scale` plus a `(x, y)` translation to map native → screen. Keeping this math
 * here (framework-free) makes "positions stable across zoom/resize" a property
 * we can unit-test without mounting a canvas.
 */

/** The stage transform: uniform scale + translation, mapping native → screen. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const SCALE_MIN = 0.1;
export const SCALE_MAX = 8;

export function clampScale(scale: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));
}

/** Map a point from native (document) space to screen (container) pixels. */
export function nativeToScreen(p: Point, view: View): Point {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

/** Map a point from screen (container) pixels back to native (document) space. */
export function screenToNative(p: Point, view: View): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

/**
 * Compute the view that fits `content` centred inside `container`, with optional
 * uniform padding. Degenerate inputs (zero/negative dimensions) fall back to the
 * identity view so the caller never divides by zero.
 */
export function fitView(content: Size, container: Size, padding = 24): View {
  if (
    content.width <= 0 ||
    content.height <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return { scale: 1, x: 0, y: 0 };
  }
  const scale = clampScale(
    Math.min(
      (container.width - padding * 2) / content.width,
      (container.height - padding * 2) / content.height,
    ),
  );
  return {
    scale,
    x: (container.width - content.width * scale) / 2,
    y: (container.height - content.height * scale) / 2,
  };
}

/**
 * Zoom by `factor` about a fixed screen-space `focal` point (wheel-zoom-to-cursor).
 * The native point under `focal` stays put after the zoom. Scale is clamped, so
 * at the limits the view is returned effectively unchanged.
 */
export function zoomAt(view: View, focal: Point, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const native = screenToNative(focal, view);
  return {
    scale,
    x: focal.x - native.x * scale,
    y: focal.y - native.y * scale,
  };
}

/** A placement: the top-left an object is drawn at, and the turn about it. */
export interface Placement {
  x: number;
  y: number;
  rotation: number;
}

/** Just enough of a Konva node to say where it currently is. */
export interface Placed {
  x: () => number;
  y: () => number;
  rotation: () => number;
}

/**
 * The group transform that carries chrome authored at `base` on to where the
 * object it belongs to *actually is* — the live node, which for a following
 * object is not where the document put it (plan §18.17).
 *
 * The same offset-and-turn `useFollowing` uses to carry a followed attack: sit
 * the group's offset on the authored top-left, its position on the live one, and
 * turn it by the difference. A child authored at document point `p` then lands
 * at `live + R(live.rotation − base.rotation) · (p − base)`, which for any point
 * of the object's own box is exactly where that part of the object now is. So
 * the chrome inside can be laid out in plain document coordinates and stay
 * ignorant of following entirely.
 *
 * Identity when the object hasn't moved, so a free object pays nothing for it.
 */
export function carryToNode(
  base: Placement,
  node: Placed,
): Placement & { offsetX: number; offsetY: number } {
  return {
    offsetX: base.x,
    offsetY: base.y,
    x: node.x(),
    y: node.y(),
    rotation: node.rotation() - base.rotation,
  };
}

/**
 * Where a transformed node's top-left belongs, given what the handle did to it
 * — or `null` to keep the node exactly where Konva put it.
 *
 * Konva's `Transformer` always turns about its bounding box's centre and offers
 * no way to move that, so a **lone** object is turned about its own origin by
 * correction: the rotation the handle produced is kept, and `x/y` are
 * re-derived so the origin is the point that didn't move (plan §18.17).
 *
 * `aboutOwnOrigin` is false for a **multi-selection**, where the bounding box
 * centre is precisely the right pivot: the objects turn about the one point
 * they share, which is what makes a group turn rigidly (plan §18.1). Konva has
 * already swung each node about that centre, so its placement is the answer and
 * correcting it per object would pin every one of them back where it started
 * and spin each about itself — the group coming apart as it turns. There is no
 * single origin for several objects to pivot on in any case, which is why the
 * origin handle appears only for a lone one.
 *
 * A pure resize corrects nothing either: `x/y` then belong to the handle being
 * dragged, and there is no rotation delta to answer for.
 */
export function pivotCorrection(
  before: Pivoted,
  node: Placed,
  aboutOwnOrigin: boolean,
): Placement | null {
  if (!aboutOwnOrigin || node.rotation() === before.rotation) return null;
  return rotateAboutPivot(before, node.rotation() - before.rotation);
}

/** A placed, sized box — enough of an object's state to transform it. */
export interface Box extends Placement {
  w: number;
  h: number;
}

/**
 * The smallest an object may be made. Below this a shape is too small to find
 * again, let alone grab by a handle — so a resize stops here rather than
 * letting something be lost on the board.
 */
export const MIN_OBJECT_SIZE = 8;

const DEG = Math.PI / 180;

/**
 * Apply to `box` the same transform that took `from` onto `to`.
 *
 * Konva's `Transformer` can only take hold of the nodes it is attached to, and
 * some of a selection is deliberately withheld from it — a hidden object keeps
 * its node so playback can reveal it, but handles drawn round something you
 * cannot see would be a lie about what you can grab. Yet a hidden member of a
 * group is still a member: leaving it behind while the rest turned would take
 * the group apart, and the deformity would only show up later, when the slide
 * that reveals it played. So the members the transformer *did* move say what
 * happened, and this carries the others by the same amount.
 *
 * A box is a frame — a corner, a turn and a size — so the transform between two
 * of them is read straight off: turn by the difference, scale by the ratio of
 * the sizes, and place `box` where that leaves it relative to `from`'s corner.
 * `box`'s offset is measured in `from`'s own frame, so it survives the turn.
 *
 * Exact for a move, a turn, and a uniform scale. A **non-uniform** resize of a
 * selection whose members sit at different angles is an approximation, because
 * the stretch happens along the transformer's axes rather than the reference
 * member's — the two coincide whenever the selection shares one angle, which is
 * every group that was laid out square and the only case where a per-axis
 * stretch has an unambiguous meaning anyway.
 */
export function carryBox(box: Box, from: Box, to: Box): Box {
  const turn = to.rotation - from.rotation;
  // A zero-sized reference has no ratio to give; it carries no scale.
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;

  // `box`'s corner, as an offset in the frame `from` sits in...
  const out = Math.cos(-from.rotation * DEG);
  const oin = Math.sin(-from.rotation * DEG);
  const dx = box.x - from.x;
  const dy = box.y - from.y;
  const u = (dx * out - dy * oin) * sx;
  const v = (dx * oin + dy * out) * sy;

  // ...and back out into the frame `to` sits in.
  const cos = Math.cos(to.rotation * DEG);
  const sin = Math.sin(to.rotation * DEG);
  return {
    x: to.x + (u * cos - v * sin),
    y: to.y + (u * sin + v * cos),
    w: box.w * sx,
    h: box.h * sy,
    rotation: box.rotation + turn,
  };
}
