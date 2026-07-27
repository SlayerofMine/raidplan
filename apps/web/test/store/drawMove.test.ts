import { beforeEach, describe, expect, it } from "vitest";
import { ICONS } from "@raidplan/shared";
import {
  clearHistory,
  temporalStore,
  useEditorStore,
} from "../../src/store/editorStore";

/**
 * Writing a drawn route onto an object (plan §7).
 *
 * The route arrives from the canvas in **centre** coordinates — that is what a
 * drawn line means — while the document stores an object's top-left. This is the
 * one place that conversion happens, so it is the one place it can be wrong.
 */
const iconId = ICONS[0]!.id;
const state = () => useEditorStore.getState();
const animOf = (slideIndex: number, index = 0) =>
  state().slides[slideIndex]!.animations[index]!;

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().setSnapEnabled(false);
  clearHistory();
});

describe("drawMove", () => {
  it("makes a move whose route is the corners, and whose end is the last one", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const { w, h } = state().slides[0]!.states[id]!;

    const animId = state().drawMove(0, id, [
      { x: 400, y: 200 },
      { x: 900, y: 600 },
    ]);

    const anim = animOf(0);
    expect(anim.id).toBe(animId);
    expect(anim).toMatchObject({
      objectId: id,
      effect: "move",
      kind: "motion",
    });
    // Every corner but the last is a waypoint; those stay centres.
    expect(anim.params?.path).toEqual([{ x: 400, y: 200 }]);
    // The destination is the object's top-left, so it is the same kind of
    // number as its slide state — converted with the size it has here.
    expect(anim.params).toMatchObject({ toX: 900 - w / 2, toY: 600 - h / 2 });
  });

  it("leaves the object where it is — a move is played, not applied", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const before = { ...state().slides[0]!.states[id]! };

    state().drawMove(0, id, [{ x: 900, y: 600 }]);

    // The slide says where the object *starts*; the animation takes it away.
    expect(state().slides[0]!.states[id]).toEqual(before);
  });

  it("a single corner is a straight move to it, with no waypoints", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().drawMove(0, id, [{ x: 900, y: 600 }]);
    expect(animOf(0).params?.path).toEqual([]);
  });

  it("redraws in place when given an animation to replace", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const first = state().drawMove(0, id, [{ x: 500, y: 500 }])!;
    // A redraw keeps the animation's identity — and so its timing, easing and
    // place in the slide's order.
    state().updateAnimation(0, first, { durationMs: 2500, easing: "none" });

    const again = state().drawMove(
      0,
      id,
      [
        { x: 200, y: 800 },
        { x: 300, y: 900 },
      ],
      first,
    );

    expect(again).toBe(first);
    expect(state().slides[0]!.animations).toHaveLength(1);
    expect(animOf(0)).toMatchObject({ durationMs: 2500, easing: "none" });
    expect(animOf(0).params?.path).toEqual([{ x: 200, y: 800 }]);
  });

  it("refuses an empty route, an unknown object, and one not on the slide", () => {
    const id = state().addIcon(iconId);
    state().addSlide(); // empty, so `id` is not in that scene

    expect(state().drawMove(0, id, [])).toBeUndefined();
    expect(state().drawMove(0, "ghost", [{ x: 1, y: 1 }])).toBeUndefined();
    expect(state().drawMove(1, id, [{ x: 1, y: 1 }])).toBeUndefined();
    expect(state().slides[0]!.animations).toEqual([]);
    expect(state().slides[1]!.animations).toEqual([]);
  });

  it("undoes in one press, however many corners were clicked", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    clearHistory();

    state().drawMove(0, id, [
      { x: 200, y: 200 },
      { x: 400, y: 300 },
      { x: 600, y: 500 },
      { x: 800, y: 800 },
    ]);
    expect(state().slides[0]!.animations).toHaveLength(1);

    temporalStore.getState().undo();
    expect(state().slides[0]!.animations).toHaveLength(0);
  });
});
