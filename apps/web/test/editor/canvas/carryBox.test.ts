import { describe, expect, it } from "vitest";
import { carryBox, type Box } from "../../../src/editor/canvas/coords";

/**
 * Carrying the members a `Transformer` could not take hold of (plan §18.1).
 *
 * A hidden object keeps its node so playback can reveal it, but never gets
 * handles — so when a group is turned, the members that *were* moved have to
 * say what happened to the one that wasn't. The property under test is
 * rigidity: whatever the handles did, the group is the same shape afterwards.
 */

const DEG = Math.PI / 180;

/** Turn `box` about `pivot`, the way a transformer swings a whole selection. */
function swing(box: Box, pivot: { x: number; y: number }, deg: number): Box {
  const cos = Math.cos(deg * DEG);
  const sin = Math.sin(deg * DEG);
  const dx = box.x - pivot.x;
  const dy = box.y - pivot.y;
  return {
    ...box,
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
    rotation: box.rotation + deg,
  };
}

const close = (a: Box, b: Box) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.w).toBeCloseTo(b.w, 6);
  expect(a.h).toBeCloseTo(b.h, 6);
  expect(a.rotation).toBeCloseTo(b.rotation, 6);
};

/** The visible member the handles moved, and the hidden one they didn't. */
const shown: Box = { x: 100, y: 100, w: 40, h: 40, rotation: 0 };
const hidden: Box = { x: 300, y: 160, w: 60, h: 20, rotation: 0 };

describe("carryBox", () => {
  it("does nothing when nothing happened", () => {
    close(carryBox(hidden, shown, shown), hidden);
  });

  it("carries a move", () => {
    const moved = { ...shown, x: shown.x + 70, y: shown.y - 25 };
    close(carryBox(hidden, shown, moved), {
      ...hidden,
      x: hidden.x + 70,
      y: hidden.y - 25,
    });
  });

  it("carries a turn about the point the group shares", () => {
    const pivot = { x: 230, y: 140 };
    const turn = 37;
    // The handles swung the visible member about the shared pivot; the hidden
    // one must land where the same swing would have put it.
    close(
      carryBox(hidden, shown, swing(shown, pivot, turn)),
      swing(hidden, pivot, turn),
    );
  });

  it("carries a turn when the members sit at different angles", () => {
    const tilted: Box = { ...hidden, rotation: 30 };
    const pivot = { x: 230, y: 140 };
    close(
      carryBox(tilted, shown, swing(shown, pivot, -80)),
      swing(tilted, pivot, -80),
    );
  });

  it("carries a resize, about the reference's own corner", () => {
    const doubled = { ...shown, w: shown.w * 2, h: shown.h * 3 };
    const carried = carryBox(hidden, shown, doubled);

    expect(carried.w).toBeCloseTo(hidden.w * 2, 6);
    expect(carried.h).toBeCloseTo(hidden.h * 3, 6);
    // Its offset from the reference grows by the same factors, so the group
    // stretches as one rather than the hidden member swelling in place.
    expect(carried.x - doubled.x).toBeCloseTo((hidden.x - shown.x) * 2, 6);
    expect(carried.y - doubled.y).toBeCloseTo((hidden.y - shown.y) * 3, 6);
  });

  it("holds the group rigid through a turn — distances and angles both", () => {
    const pivot = { x: 230, y: 140 };
    const moved = swing(shown, pivot, 137);
    const carried = carryBox(hidden, shown, moved);

    expect(Math.hypot(carried.x - moved.x, carried.y - moved.y)).toBeCloseTo(
      Math.hypot(hidden.x - shown.x, hidden.y - shown.y),
      6,
    );
    expect(carried.rotation - moved.rotation).toBeCloseTo(
      hidden.rotation - shown.rotation,
      6,
    );
  });

  it("survives a reference with no size to give a ratio from", () => {
    const flat: Box = { x: 0, y: 0, w: 0, h: 0, rotation: 0 };
    const carried = carryBox(hidden, flat, { ...flat, x: 10, y: 10 });
    // No scale to read, so it is carried bodily rather than collapsed to NaN.
    close(carried, { ...hidden, x: hidden.x + 10, y: hidden.y + 10 });
  });
});
