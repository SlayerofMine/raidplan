import { describe, expect, it } from "vitest";
import { pivotPoint, type Pivoted } from "@raidplan/shared";
import { carryToNode } from "../../../src/editor/canvas/coords";

/**
 * Keeping the origin handle on a **following** object (plan §18.17).
 *
 * `useFollowing` solves a pin on to the live Konva node and leaves the document
 * alone, so the crosshair — which is drawn from the document — has to be carried
 * across to where the object actually hangs. The correction is a group
 * transform, so the assertion is what a child authored at a document point ends
 * up drawn at: apply the transform by hand and check the crosshair lands on the
 * object's origin, wherever the thing it follows has dragged it to.
 */

/** Where a child authored at `p` is drawn, once the group carries the handle. */
function drawnAt(
  attrs: ReturnType<typeof carryToNode>,
  p: { x: number; y: number },
): { x: number; y: number } {
  const rad = (attrs.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - attrs.offsetX;
  const dy = p.y - attrs.offsetY;
  return {
    x: attrs.x + dx * cos - dy * sin,
    y: attrs.y + dx * sin + dy * cos,
  };
}

/** A stand-in for the object's node, which the follow runtime has moved. */
const node = (x: number, y: number, rotation = 0) => ({
  x: () => x,
  y: () => y,
  rotation: () => rotation,
});

const close = (p: { x: number; y: number }, q: { x: number; y: number }) => {
  expect(p.x).toBeCloseTo(q.x, 6);
  expect(p.y).toBeCloseTo(q.y, 6);
};

describe("carrying the origin handle on to a followed object", () => {
  /** Authored top-left, with the origin a third of the way in and up. */
  const authored: Pivoted = {
    x: 100,
    y: 100,
    w: 60,
    h: 40,
    rotation: 0,
    ox: 0.33,
    oy: 0.25,
  };
  const base = { x: authored.x, y: authored.y, rotation: authored.rotation };

  it("leaves a handle alone when the object is where the document says", () => {
    const attrs = carryToNode(base, node(authored.x, authored.y));
    close(drawnAt(attrs, pivotPoint(authored)), pivotPoint(authored));
  });

  it("follows the pin when the object it hangs from has been dragged away", () => {
    // The follow runtime has slid the object 240 right and 90 up.
    const live = { ...authored, x: 340, y: 10 };
    const attrs = carryToNode(base, node(live.x, live.y));
    close(drawnAt(attrs, pivotPoint(authored)), pivotPoint(live));
  });

  it("turns with the object when what it aims at has moved", () => {
    const live = { ...authored, x: 340, y: 10, rotation: 37 };
    const attrs = carryToNode(base, node(live.x, live.y, live.rotation));
    close(drawnAt(attrs, pivotPoint(authored)), pivotPoint(live));

    // The direction arrow is drawn from the origin at the object's facing, so
    // the whole arm has to come round with it, not just the crosshair.
    const authoredTip = {
      x: pivotPoint(authored).x + 56,
      y: pivotPoint(authored).y,
    };
    const rad = (live.rotation * Math.PI) / 180;
    close(drawnAt(attrs, authoredTip), {
      x: pivotPoint(live).x + 56 * Math.cos(rad),
      y: pivotPoint(live).y + 56 * Math.sin(rad),
    });
  });

  it("carries the handle when the object was authored turned", () => {
    const turned: Pivoted = { ...authored, rotation: 20 };
    const turnedBase = { x: turned.x, y: turned.y, rotation: turned.rotation };
    const live = { ...turned, x: -40, y: 260, rotation: 155 };
    const attrs = carryToNode(turnedBase, node(live.x, live.y, live.rotation));
    close(drawnAt(attrs, pivotPoint(turned)), pivotPoint(live));
  });
});
