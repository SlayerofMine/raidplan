import type { Point } from "./transform.js";

/**
 * The route a `move` takes (plan §7 "Motion paths").
 *
 * Pure geometry — no GSAP, no DOM, no Konva. Four separate things have to agree
 * on exactly where the curve goes: the editor overlay that draws it, the
 * playback compiler that walks it, the offline frame renderer that samples it
 * per frame, and the server-side SVG renderer. Deliberately **not** GSAP's
 * MotionPathPlugin, because only one of those four could use it and the other
 * three would each need their own implementation to drift out of sync with —
 * the same discipline `resolveObjectState` and `layoutStepTimeline` are held to.
 *
 * The curve is a Catmull-Rom spline through the given points, expressed as cubic
 * béziers (which is what SVG and Konva both draw natively). `curve: 0` pulls the
 * control points onto the thirds of each chord, so the result is exactly the
 * polyline, traversed at a uniform speed — and a two-point path at `curve: 0` is
 * exactly the straight line a `move` drew before paths existed.
 */

/** One cubic bézier: `from` → `to`, bending towards `c1` then `c2`. */
export interface PathSegment {
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}

export interface MotionPath {
  segments: PathSegment[];
  /** Where the route begins — the answer for a degenerate one with no segments. */
  start: Point;
  /**
   * Cumulative arc length at each sample, `length[0] === 0`. Used to walk the
   * curve at constant speed — see {@link samplePath}.
   */
  lengths: number[];
  /** The `t` of each entry in {@link lengths}, in whole-path parameter space. */
  stops: number[];
  totalLength: number;
}

/**
 * Arc-length samples per segment. 24 keeps a full-board S-curve within a
 * fraction of a pixel of true constant speed, which is well below what the eye
 * catches on a moving token, and costs nothing at authoring time — a path is
 * rebuilt when it is edited, not per frame.
 */
const SAMPLES_PER_SEGMENT = 24;

/** Points closer than this are the same point; a zero-length segment has no tangent. */
const EPSILON = 1e-9;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Build a path through `points` (the **full** route, endpoints included).
 *
 * Consecutive duplicate points are dropped: a waypoint dragged exactly onto its
 * neighbour would otherwise contribute a zero-length segment with no direction,
 * which turns the tangent — and any arrowhead drawn from it — into NaN.
 */
export function buildMotionPath(
  points: readonly Point[],
  curve = 0,
): MotionPath {
  const anchors: Point[] = [];
  for (const point of points) {
    const last = anchors[anchors.length - 1];
    if (
      last &&
      Math.abs(last.x - point.x) < EPSILON &&
      Math.abs(last.y - point.y) < EPSILON
    ) {
      continue;
    }
    anchors.push({ x: point.x, y: point.y });
  }

  const segments: PathSegment[] = [];
  // A path needs two distinct anchors to go anywhere. One (or none) is a
  // degenerate route — `samplePath` answers with that single point.
  for (let i = 0; i + 1 < anchors.length; i++) {
    const from = anchors[i]!;
    const to = anchors[i + 1]!;
    // Catmull-Rom: each control point leans along the chord *skipping* this
    // anchor, so the curve passes through every waypoint rather than merely
    // being pulled towards it. Clamped ends (`?? from` / `?? to`) keep the first
    // and last segments from flicking outwards.
    const before = anchors[i - 1] ?? from;
    const after = anchors[i + 2] ?? to;
    // Blend between two control-point placements rather than scaling one down
    // to nothing. At `curve: 1` these are the Catmull-Rom controls; at `0` they
    // are the thirds of the chord, which is the *uniform-speed* cubic form of a
    // straight line. Collapsing them onto the anchors instead would draw the
    // same straight line but traverse it like a smoothstep, leaving `samplePath`
    // to undo that with nothing but LUT resolution to do it with.
    segments.push({
      from,
      c1: {
        x: lerp(
          from.x + (to.x - from.x) / 3,
          from.x + (to.x - before.x) / 6,
          curve,
        ),
        y: lerp(
          from.y + (to.y - from.y) / 3,
          from.y + (to.y - before.y) / 6,
          curve,
        ),
      },
      c2: {
        x: lerp(
          to.x - (to.x - from.x) / 3,
          to.x - (after.x - from.x) / 6,
          curve,
        ),
        y: lerp(
          to.y - (to.y - from.y) / 3,
          to.y - (after.y - from.y) / 6,
          curve,
        ),
      },
      to,
    });
  }

  const lengths = [0];
  const stops = [0];
  let total = 0;
  let previous = segments[0]?.from ?? anchors[0] ?? { x: 0, y: 0 };
  for (let i = 0; i < segments.length; i++) {
    for (let s = 1; s <= SAMPLES_PER_SEGMENT; s++) {
      const local = s / SAMPLES_PER_SEGMENT;
      const point = cubicAt(segments[i]!, local);
      total += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
      lengths.push(total);
      stops.push((i + local) / segments.length);
    }
  }

  return {
    segments,
    start: anchors[0] ?? { x: 0, y: 0 },
    lengths,
    stops,
    totalLength: total,
  };
}

/** A point on one cubic bézier at local parameter `t` ∈ [0,1]. */
function cubicAt(segment: PathSegment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x:
      a * segment.from.x +
      b * segment.c1.x +
      c * segment.c2.x +
      d * segment.to.x,
    y:
      a * segment.from.y +
      b * segment.c1.y +
      c * segment.c2.y +
      d * segment.to.y,
  };
}

/** The derivative of one cubic bézier at local `t` — its direction, unnormalised. */
function cubicSlopeAt(segment: PathSegment, t: number): Point {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x:
      a * (segment.c1.x - segment.from.x) +
      b * (segment.c2.x - segment.c1.x) +
      c * (segment.to.x - segment.c2.x),
    y:
      a * (segment.c1.y - segment.from.y) +
      b * (segment.c2.y - segment.c1.y) +
      c * (segment.to.y - segment.c2.y),
  };
}

/**
 * Map a progress fraction to whole-path parameter space, **by arc length**.
 *
 * Without this an object would cover every segment in equal time regardless of
 * length, visibly lurching as it crossed a short one. Playback eases `t` and
 * expects the result to move at a constant speed along the drawn route.
 */
function arcLengthToParam(path: MotionPath, t: number): number {
  if (path.totalLength <= EPSILON) return 0;
  const target = t * path.totalLength;
  const { lengths, stops } = path;

  let lo = 0;
  let hi = lengths.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return stops[0]!;

  const before = lengths[lo - 1]!;
  const span = lengths[lo]! - before;
  const within = span > EPSILON ? (target - before) / span : 0;
  return lerp(stops[lo - 1]!, stops[lo]!, within);
}

/** Split a whole-path parameter into `[segment, local t]`. */
function locate(path: MotionPath, param: number): [PathSegment, number] | null {
  const count = path.segments.length;
  if (count === 0) return null;
  const scaled = Math.min(Math.max(param, 0), 1) * count;
  const index = Math.min(Math.floor(scaled), count - 1);
  return [path.segments[index]!, scaled - index];
}

/**
 * Where the path is at progress `t` ∈ [0,1] — **constant speed**, so `t = 0.5`
 * is the halfway point along the route rather than the midpoint of whichever
 * segment happens to be second.
 */
export function samplePath(path: MotionPath, t: number): Point {
  const found = locate(
    path,
    arcLengthToParam(path, Math.min(Math.max(t, 0), 1)),
  );
  // A route with no length is a single point; it is where it is at every t.
  if (!found) return { ...path.start };
  const [segment, local] = found;
  return cubicAt(segment, local);
}

/**
 * The heading at progress `t`, in degrees clockwise from +x (Konva's y-down
 * convention, matching `angleDeg` in `transform.ts`). Used for the overlay's
 * arrowhead. Returns 0 for a degenerate path, which points right — the same
 * thing an object with no direction does everywhere else.
 */
export function pathTangent(path: MotionPath, t: number): number {
  const found = locate(
    path,
    arcLengthToParam(path, Math.min(Math.max(t, 0), 1)),
  );
  if (!found) return 0;
  const [segment, local] = found;
  let slope = cubicSlopeAt(segment, local);
  // A cubic's derivative can vanish where a control point coincides with its
  // anchor. Fall back to the chord, which is the direction the segment travels
  // in — an arrowhead aimed at nothing is worse than one aimed approximately.
  if (Math.hypot(slope.x, slope.y) < EPSILON) {
    slope = {
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y,
    };
  }
  if (Math.hypot(slope.x, slope.y) < EPSILON) return 0;
  return (Math.atan2(slope.y, slope.x) * 180) / Math.PI;
}

/**
 * The path as an SVG `d` string — drawn by the API's OG renderer and by the
 * editor's Konva `<Path>` overlay, from this one source so the planner's
 * preview and the rendered image show the same curve.
 */
export function pathToSvgD(path: MotionPath): string {
  const first = path.segments[0];
  if (!first) return "";
  const round = (n: number) => Math.round(n * 100) / 100;
  let d = `M ${round(first.from.x)} ${round(first.from.y)}`;
  for (const s of path.segments) {
    d += ` C ${round(s.c1.x)} ${round(s.c1.y)} ${round(s.c2.x)} ${round(s.c2.y)} ${round(s.to.x)} ${round(s.to.y)}`;
  }
  return d;
}
