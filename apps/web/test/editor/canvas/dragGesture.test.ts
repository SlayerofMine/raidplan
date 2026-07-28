import { afterEach, describe, expect, it } from "vitest";
import { claimDrag, releaseDrag } from "../../../src/editor/canvas/dragGesture";

/**
 * Dragging a multi-selection makes *every* member a real drag of its own —
 * Konva's `Transformer` calls `startDrag` on the nodes the pointer didn't grab.
 * One of them has to speak for the gesture, or each commits separately and the
 * group comes apart one undo at a time.
 */
describe("dragGesture", () => {
  afterEach(() => {
    // Whoever ended up holding it, so one test can't strand the next.
    releaseDrag("a");
    releaseDrag("b");
    releaseDrag("c");
  });

  it("gives the lead to the node that started first", () => {
    expect(claimDrag("a")).toBe(true);
  });

  it("refuses everyone else for the rest of the gesture", () => {
    claimDrag("a");
    expect(claimDrag("b")).toBe(false);
    expect(claimDrag("c")).toBe(false);
  });

  it("frees the lead on release, so the next drag can be led", () => {
    claimDrag("a");
    releaseDrag("a");
    expect(claimDrag("b")).toBe(true);
  });

  it("ignores a release from a node that never held the lead", () => {
    claimDrag("a");
    releaseDrag("b");
    expect(claimDrag("c")).toBe(false);
  });

  it("lets the same node lead again next time", () => {
    claimDrag("a");
    releaseDrag("a");
    expect(claimDrag("a")).toBe(true);
  });
});
