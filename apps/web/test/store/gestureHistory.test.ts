import { beforeEach, describe, expect, it } from "vitest";
import { ICONS } from "@raidplan/shared";
import {
  clearHistory,
  temporalStore,
  useEditorStore,
} from "../../src/store/editorStore";
import { beginGesture, endGesture } from "../../src/store/gestureHistory";

/**
 * A drag is one edit, not one per frame (plan §2.7).
 *
 * Dragging a motion path's node or its destination rewrites the animation every
 * frame so the route follows the cursor. Without this, letting go of a handle
 * left fifty entries in the history and undo crawled back along the drag.
 */
const iconId = ICONS[0]!.id;
const state = () => useEditorStore.getState();
const depth = () => temporalStore.getState().pastStates.length;
const pathOf = (animId: string) =>
  state().slides[0]!.animations.find((a) => a.id === animId)!.params?.path ??
  [];

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().setSnapEnabled(false);
  clearHistory();
});

describe("gestureHistory", () => {
  it("records a dragged waypoint as a single undo step", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const animId = state().drawMove(0, id, [{ x: 400, y: 400 }])!;
    const before = pathOf(animId);
    clearHistory();

    const drag = (path: { x: number; y: number }[]) =>
      state().updateAnimation(0, animId, {
        params: { ...state().slides[0]!.animations[0]!.params, path },
      });

    // The gesture: many frames, then release.
    beginGesture();
    for (let i = 1; i <= 20; i++) drag([{ x: 200 + i, y: 200 }]);
    const settled = [{ x: 220, y: 200 }];
    endGesture({
      rewind: () => drag(before),
      commit: () => drag(settled),
    });

    expect(depth()).toBe(1);
    expect(pathOf(animId)).toEqual(settled);

    temporalStore.getState().undo();
    expect(pathOf(animId)).toEqual(before);
  });

  it("leaves no entry when a gesture ends without moving anything", () => {
    state().addIcon(iconId, { x: 100, y: 100 });
    clearHistory();

    beginGesture();
    endGesture(null);

    expect(depth()).toBe(0);
  });
});
