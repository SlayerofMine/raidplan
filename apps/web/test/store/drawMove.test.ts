import { beforeEach, describe, expect, it } from "vitest";
import { ICONS } from "@raidplan/shared";
import {
  clearHistory,
  temporalStore,
  useEditorStore,
} from "../../src/store/editorStore";

/**
 * Writing a drawn route onto an object as chained `move`s (plan §7).
 *
 * A drawn route is **one animation per leg**: the corners are the joins between
 * moves, not waypoints inside one. That is what gives every leg its own bar in
 * the timeline, so "run in, wait, run out" is three legs with a delay on the
 * third rather than a single move nobody can pause in the middle of.
 *
 * The route arrives from the canvas in **centre** coordinates — that is what a
 * drawn line means — while the document stores an object's top-left. This is the
 * one place that conversion happens, so it is the one place it can be wrong.
 */
const iconId = ICONS[0]!.id;
const state = () => useEditorStore.getState();
const anims = (slideIndex: number) => state().slides[slideIndex]!.animations;
const animOf = (slideIndex: number, index = 0) => anims(slideIndex)[index]!;
/** Where an object's centre sits on a slide — the end a drawn route starts from. */
const centreOf = (slideIndex: number, id: string) => {
  const s = state().slides[slideIndex]!.states[id]!;
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
};

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().setSnapEnabled(false);
  clearHistory();
});

describe("drawMove", () => {
  it("makes one move per leg, each ending on the corner it was drawn to", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const { w, h } = state().slides[0]!.states[id]!;

    const animId = state().drawMove(0, id, [
      { x: 400, y: 200 },
      { x: 900, y: 600 },
    ]);

    expect(anims(0)).toHaveLength(2);
    // The first leg is the one that is handed back — it is where the journey,
    // and the selection, begins.
    expect(animOf(0).id).toBe(animId);
    expect(animOf(0)).toMatchObject({
      objectId: id,
      effect: "move",
      kind: "motion",
      trigger: "onEnter",
    });
    // Each destination is the object's top-left, so it is the same kind of
    // number as its slide state — converted with the size it has here.
    expect(animOf(0).params).toMatchObject({
      toX: 400 - w / 2,
      toY: 200 - h / 2,
    });
    // A leg is a straight hop: the corners are joins now, not waypoints.
    expect(animOf(0).params?.path).toBeUndefined();

    // The second leg picks up where the first left off, back to back with it.
    expect(animOf(0, 1)).toMatchObject({
      objectId: id,
      trigger: "afterPrevious",
      delayMs: 0,
    });
    expect(animOf(0, 1).params).toMatchObject({
      toX: 900 - w / 2,
      toY: 600 - h / 2,
    });
  });

  it("shares the default duration between the legs, by length", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const start = centreOf(0, id);

    // One leg three times the length of the other, drawn along a straight line
    // so the lengths are plain to read.
    state().drawMove(0, id, [
      { x: start.x + 100, y: start.y },
      { x: start.x + 400, y: start.y },
    ]);

    // Constant speed across the whole route: a quarter of the distance is a
    // quarter of the time, so the object doesn't dawdle over the short leg.
    expect(animOf(0).durationMs).toBe(250);
    expect(animOf(0, 1).durationMs).toBe(750);
  });

  it("leaves the object where it is — a move is played, not applied", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const before = { ...state().slides[0]!.states[id]! };

    state().drawMove(0, id, [{ x: 900, y: 600 }]);

    // The slide says where the object *starts*; the animation takes it away.
    expect(state().slides[0]!.states[id]).toEqual(before);
  });

  it("a single corner is one straight move to it", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().drawMove(0, id, [{ x: 900, y: 600 }]);
    expect(anims(0)).toHaveLength(1);
    expect(animOf(0).durationMs).toBe(1000);
  });

  it("chains a second drawn move onto the first, from where it ended", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const { w, h } = state().slides[0]!.states[id]!;
    state().drawMove(0, id, [{ x: 500, y: 500 }]);

    // Drawing again while the object already moves means "and then this" — not
    // a second journey racing the first from the slide's opening layout.
    state().drawMove(0, id, [{ x: 500, y: 900 }]);

    expect(anims(0)).toHaveLength(2);
    expect(animOf(0, 1)).toMatchObject({ trigger: "afterPrevious" });
    expect(animOf(0, 1).params).toMatchObject({
      toX: 500 - w / 2,
      toY: 900 - h / 2,
    });
    // The second leg's length is measured from where the first one left the
    // object, not from where the slide opened: 400px, not 800.
    expect(animOf(0, 1).durationMs).toBe(1000);
  });

  it("redraws in place, keeping the leg's identity and splitting its time", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    // Redrawing the first leg starts it where the slide opens, as it did.
    const start = centreOf(0, id);
    const first = state().drawMove(0, id, [{ x: 500, y: 500 }])!;
    // A redraw keeps the animation's identity — and so its timing, easing and
    // place in the slide's order.
    state().updateAnimation(0, first, { durationMs: 2000, easing: "none" });

    const again = state().drawMove(
      0,
      id,
      [
        { x: start.x + 300, y: start.y },
        { x: start.x + 300, y: start.y + 100 },
      ],
      first,
    );

    expect(again).toBe(first);
    // Two legs now, and the new one sits directly after the one it came from.
    expect(anims(0)).toHaveLength(2);
    expect(animOf(0)).toMatchObject({ id: first, easing: "none" });
    expect(animOf(0, 1)).toMatchObject({
      easing: "none",
      trigger: "afterPrevious",
    });
    // The redrawn leg's own duration is what gets shared out, not the default.
    expect(animOf(0).durationMs + animOf(0, 1).durationMs).toBe(2000);
    expect(animOf(0).durationMs).toBe(1500);
  });

  it("redraws a click-triggered move as one animation, corners and all", () => {
    // A click fires one animation, so there is nothing for a second leg to
    // follow — its corners stay waypoints inside the one move.
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const only = state().drawMove(0, id, [{ x: 500, y: 500 }])!;
    state().updateAnimation(0, only, { trigger: "onClick" });

    const again = state().drawMove(
      0,
      id,
      [
        { x: 200, y: 800 },
        { x: 300, y: 900 },
      ],
      only,
    );

    expect(again).toBe(only);
    expect(anims(0)).toHaveLength(1);
    expect(animOf(0).params?.path).toEqual([{ x: 200, y: 800 }]);
  });

  it("refuses an empty route, an unknown object, and one not on the slide", () => {
    const id = state().addIcon(iconId);
    state().addSlide(); // empty, so `id` is not in that scene

    expect(state().drawMove(0, id, [])).toBeUndefined();
    expect(state().drawMove(0, "ghost", [{ x: 1, y: 1 }])).toBeUndefined();
    expect(state().drawMove(1, id, [{ x: 1, y: 1 }])).toBeUndefined();
    expect(anims(0)).toEqual([]);
    expect(anims(1)).toEqual([]);
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
    expect(anims(0)).toHaveLength(4);

    // Four legs, but one gesture: taking it back is one press.
    temporalStore.getState().undo();
    expect(anims(0)).toHaveLength(0);
  });
});
