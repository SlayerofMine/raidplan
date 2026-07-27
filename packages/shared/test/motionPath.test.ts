import { describe, expect, it } from "vitest";
import {
  buildMotionPath,
  pathTangent,
  pathToSvgD,
  samplePath,
} from "../src/motionPath.js";
import type { Point } from "../src/transform.js";

const at = (x: number, y: number): Point => ({ x, y });

/** Distance between two points, for the constant-speed checks. */
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe("buildMotionPath", () => {
  it("makes one segment per leg", () => {
    const path = buildMotionPath([at(0, 0), at(10, 0), at(20, 0)]);
    expect(path.segments).toHaveLength(2);
  });

  it("drops a duplicated point rather than making a zero-length segment", () => {
    // A waypoint dragged exactly onto its neighbour has no direction, which
    // turns the tangent — and the arrowhead drawn from it — into NaN.
    const path = buildMotionPath([at(0, 0), at(10, 0), at(10, 0), at(20, 0)]);
    expect(path.segments).toHaveLength(2);
    expect(pathTangent(path, 0.5)).not.toBeNaN();
  });

  it("puts control points at the thirds of the chord at curve 0", () => {
    // Not on the anchors: that draws the same straight line but traverses it
    // like a smoothstep, and `samplePath` would then have to undo the easing.
    const [segment] = buildMotionPath([at(0, 0), at(300, 0)], 0).segments;
    expect(segment!.c1.x).toBeCloseTo(100, 6);
    expect(segment!.c2.x).toBeCloseTo(200, 6);
  });

  it("survives a degenerate route of one point", () => {
    const path = buildMotionPath([at(5, 5)]);
    expect(path.segments).toHaveLength(0);
    expect(path.totalLength).toBe(0);
    expect(samplePath(path, 0.5)).toEqual(at(5, 5));
    expect(pathTangent(path, 0.5)).toBe(0);
  });

  it("survives an empty route", () => {
    const path = buildMotionPath([]);
    expect(path.segments).toHaveLength(0);
    expect(samplePath(path, 0.5)).toEqual(at(0, 0));
  });
});

describe("samplePath", () => {
  it("is a straight line for two points — the pre-routes behaviour", () => {
    // The pathless `move` case must stay exactly what it was, so a route of
    // just its endpoints has to reproduce plain linear interpolation.
    const path = buildMotionPath([at(0, 0), at(100, 200)]);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = samplePath(path, t);
      expect(p.x).toBeCloseTo(100 * t, 6);
      expect(p.y).toBeCloseTo(200 * t, 6);
    }
  });

  it("passes exactly through each waypoint at curve 0", () => {
    const path = buildMotionPath([at(0, 0), at(100, 0), at(100, 100)], 0);
    // Both legs are 100 long, so the corner is the halfway point by arc length.
    const corner = samplePath(path, 0.5);
    expect(corner.x).toBeCloseTo(100, 4);
    expect(corner.y).toBeCloseTo(0, 4);
  });

  it("passes through each waypoint when curved too", () => {
    // Catmull-Rom interpolates its anchors rather than merely approaching them,
    // which is what makes a dragged waypoint mean "go through here".
    const path = buildMotionPath([at(0, 0), at(100, 60), at(200, 0)], 1);
    const middle = samplePath(path, 0.5);
    expect(middle.x).toBeCloseTo(100, 1);
    expect(middle.y).toBeCloseTo(60, 1);
  });

  it("clamps t outside 0..1", () => {
    const path = buildMotionPath([at(0, 0), at(100, 0)]);
    expect(samplePath(path, -5)).toEqual(samplePath(path, 0));
    expect(samplePath(path, 5)).toEqual(samplePath(path, 1));
  });

  it("hits both ends exactly", () => {
    const path = buildMotionPath([at(3, 4), at(50, 9), at(120, 77)], 1);
    expect(samplePath(path, 0).x).toBeCloseTo(3, 6);
    expect(samplePath(path, 0).y).toBeCloseTo(4, 6);
    expect(samplePath(path, 1).x).toBeCloseTo(120, 6);
    expect(samplePath(path, 1).y).toBeCloseTo(77, 6);
  });

  it("moves at a constant speed across legs of very different lengths", () => {
    // Without arc-length parameterisation each leg would take equal *time*, so
    // the object would crawl along the short one and bolt down the long one —
    // which reads as a bug, not as easing.
    const path = buildMotionPath([at(0, 0), at(10, 0), at(510, 0)], 0);
    const steps = 40;
    const distances: number[] = [];
    let previous = samplePath(path, 0);
    for (let i = 1; i <= steps; i++) {
      const here = samplePath(path, i / steps);
      distances.push(gap(previous, here));
      previous = here;
    }
    const expected = path.totalLength / steps;
    for (const d of distances) {
      // Within 5% of the even share — the residual is the sampling resolution.
      expect(Math.abs(d - expected) / expected).toBeLessThan(0.05);
    }
  });

  it("advances monotonically along the route", () => {
    const path = buildMotionPath([at(0, 0), at(100, 100), at(200, 0)], 1);
    let covered = 0;
    let previous = samplePath(path, 0);
    for (let i = 1; i <= 50; i++) {
      const here = samplePath(path, i / 50);
      const advance = gap(previous, here);
      expect(advance).toBeGreaterThan(0);
      covered += advance;
      previous = here;
    }
    expect(covered).toBeCloseTo(path.totalLength, 0);
  });
});

describe("pathTangent", () => {
  it("reads 0 degrees along +x", () => {
    expect(
      pathTangent(buildMotionPath([at(0, 0), at(100, 0)]), 0.5),
    ).toBeCloseTo(0, 6);
  });

  it("reads 90 degrees along +y (Konva is y-down, so clockwise)", () => {
    expect(
      pathTangent(buildMotionPath([at(0, 0), at(0, 100)]), 0.5),
    ).toBeCloseTo(90, 6);
  });

  it("has a direction at both ends of a route, not just in the middle", () => {
    // The arrowhead is drawn from the tangent at the very end, so a vanishing
    // derivative there would aim it nowhere.
    const path = buildMotionPath([at(0, 0), at(100, 0)], 0);
    expect(pathTangent(path, 0)).toBeCloseTo(0, 6);
    expect(pathTangent(path, 1)).toBeCloseTo(0, 6);
  });
});

describe("pathToSvgD", () => {
  it("is empty for a route with no segments", () => {
    expect(pathToSvgD(buildMotionPath([at(1, 1)]))).toBe("");
  });

  it("opens with a moveto at the start and emits one curve per segment", () => {
    const d = pathToSvgD(buildMotionPath([at(0, 0), at(10, 0), at(20, 0)], 0));
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.match(/C /g)).toHaveLength(2);
  });

  it("ends at the route's destination", () => {
    const d = pathToSvgD(buildMotionPath([at(0, 0), at(40, 25)], 0));
    expect(d.endsWith("40 25")).toBe(true);
  });
});
