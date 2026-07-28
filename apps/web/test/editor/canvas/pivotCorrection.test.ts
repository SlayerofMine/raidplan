import { describe, expect, it } from "vitest";
import { pivotPoint, type Pivoted } from "@raidplan/shared";
import { pivotCorrection } from "../../../src/editor/canvas/coords";

/**
 * What a rotation handle writes back to the document (plan §18.17, §18.1).
 *
 * A **lone** object turns about its own origin, so the correction re-derives
 * its top-left to leave that origin exactly where it was. Several objects
 * turning together turn about the point they *share* — Konva's transformer has
 * already swung every node about the selection's bounding-box centre, so the
 * answer is to leave its placement alone. Correcting each one individually is
 * what made a group come apart the moment it was turned: every member snapped
 * back to where it started and spun on the spot.
 */

const DEG = Math.PI / 180;

/** A stand-in for the Konva node the transformer has just moved. */
const node = (x: number, y: number, rotation: number) => ({
  x: () => x,
  y: () => y,
  rotation: () => rotation,
});

/**
 * What Konva does to a node in a multi-node transform: swing its top-left about
 * the shared `pivot` and add the same turn to its rotation. Rigid by
 * construction, which is exactly the placement the correction must not touch.
 */
function swing(
  t: Pivoted,
  pivot: { x: number; y: number },
  deltaDeg: number,
): ReturnType<typeof node> {
  const rad = deltaDeg * DEG;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = t.x - pivot.x;
  const dy = t.y - pivot.y;
  return node(
    pivot.x + dx * cos - dy * sin,
    pivot.y + dx * sin + dy * cos,
    t.rotation + deltaDeg,
  );
}

const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Two boxes side by side, the second turned, with origins off their centres. */
const left: Pivoted = { x: 100, y: 100, w: 40, h: 40, rotation: 0, ox: 0.25 };
const right: Pivoted = { x: 300, y: 160, w: 60, h: 20, rotation: 30, oy: 0.1 };
/** The centre of the box round both of them — what the transformer pivots on. */
const shared = { x: 230, y: 140 };

describe("a lone object turns about its own origin", () => {
  it("re-derives the top-left so the origin never moves", () => {
    const before = pivotPoint(left);
    const placed = pivotCorrection(left, node(999, 999, 90), true);

    expect(placed).not.toBeNull();
    expect(placed!.rotation).toBe(90);
    // The handle's own placement is discarded — the origin is what is held.
    const after = pivotPoint({ ...left, ...placed! });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("corrects nothing for a pure resize", () => {
    // Same rotation: `x/y` belong to the handle being dragged.
    expect(
      pivotCorrection(left, node(120, 120, left.rotation), true),
    ).toBeNull();
  });
});

describe("several objects turn about the point they share", () => {
  it("keeps the transformer's placement", () => {
    for (const box of [left, right]) {
      expect(pivotCorrection(box, swing(box, shared, 45), false)).toBeNull();
    }
  });

  it("holds the group rigid — every member keeps its place in it", () => {
    const turn = 37;
    const settle = (box: Pivoted): Pivoted => {
      const moved = swing(box, shared, turn);
      const placed = pivotCorrection(box, moved, false);
      return {
        ...box,
        x: placed?.x ?? moved.x(),
        y: placed?.y ?? moved.y(),
        rotation: moved.rotation(),
      };
    };
    const a = settle(left);
    const b = settle(right);

    // The two are as far apart as they were, and still face each other the
    // same way: the whole of "a group stays equal to one another".
    expect(distance(pivotPoint(a), pivotPoint(b))).toBeCloseTo(
      distance(pivotPoint(left), pivotPoint(right)),
      6,
    );
    expect(a.rotation - b.rotation).toBeCloseTo(
      left.rotation - right.rotation,
      6,
    );
    // And each turned by the amount the handle was dragged, not by zero.
    expect(a.rotation).toBeCloseTo(left.rotation + turn, 6);
  });

  it("would tear the group apart if each member were corrected", () => {
    // The bug, pinned: with `aboutOwnOrigin` true every member is put back on
    // its own origin, so the distance between them collapses to what it was
    // while both spin on the spot.
    const turn = 37;
    const corrected = (box: Pivoted): Pivoted => ({
      ...box,
      ...pivotCorrection(box, swing(box, shared, turn), true)!,
    });
    const a = corrected(left);
    const b = corrected(right);

    // Each origin held still — which for a lone object is the point, and for a
    // group means nothing travelled round the shared centre at all.
    expect(pivotPoint(a).x).toBeCloseTo(pivotPoint(left).x, 6);
    expect(pivotPoint(b).x).toBeCloseTo(pivotPoint(right).x, 6);
  });
});
