import { beforeEach, describe, expect, it } from "vitest";
import { resolveObjectState } from "@raidplan/shared";
import { ICONS } from "@raidplan/shared";
import {
  clearHistory,
  temporalStore,
  useEditorStore,
} from "../../src/store/editorStore";

const iconId = ICONS[0]!.id;
const state = () => useEditorStore.getState();
/** The state an object resolves to on a given slide. */
const at = (id: string, slideIndex: number) =>
  resolveObjectState(state().objects[id]!, state().slides, slideIndex);

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().setSnapEnabled(false);
  clearHistory();
});

describe("slides — CRUD", () => {
  it("starts on an opening slide, because a plan always has one", () => {
    expect(state().slides).toHaveLength(1);
    expect(state().currentSlideIndex).toBe(0);
  });

  it("addSlide appends and selects the new slide", () => {
    state().addSlide();
    expect(state().slides).toHaveLength(2);
    expect(state().currentSlideIndex).toBe(1);
    state().addSlide();
    expect(state().slides).toHaveLength(3);
    expect(state().currentSlideIndex).toBe(2);
  });

  it("addSlide opens an empty stage", () => {
    // A slide is its own scene. Carrying the last one's cast over is a thing to
    // ask for — that is what `continueSlide` is — not the price of adding one.
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().addSlide();
    expect(state().slides[1]!.states).toEqual({});
    expect(at(id, 1).visible).toBe(false);
  });

  it("continueSlide carries the cast over, where it was left", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().moveObject(id, 640, 480);

    state().continueSlide(0);

    expect(state().currentSlideIndex).toBe(1);
    expect(at(id, 1)).toMatchObject({ x: 640, y: 480, visible: true });
  });

  it("continueSlide copies where things are, not what happens", () => {
    // The difference from duplicate: this is the "and then…" slide, so it
    // starts with nothing happening on it.
    const id = state().addIcon(iconId);
    state().addAnimation(0, id);

    state().continueSlide(0);

    expect(state().slides[1]!.states[id]).toBeDefined();
    expect(state().slides[1]!.animations).toEqual([]);
  });

  it("continueSlide inserts after its source, not at the end", () => {
    state().addSlide();
    state().addSlide();
    state().continueSlide(0);
    expect(state().slides).toHaveLength(4);
    expect(state().currentSlideIndex).toBe(1);
  });

  it("duplicateSlide copies the layout and gives animations fresh ids", () => {
    const id = state().addIcon(iconId);
    state().continueSlide(0);
    state().moveObject(id, 500, 500);
    state().addAnimation(1, id);

    state().duplicateSlide(1);
    expect(state().slides).toHaveLength(3);
    const [, first, copy] = state().slides;
    expect(copy!.states).toEqual(first!.states);
    expect(copy!.id).not.toBe(first!.id);
    expect(copy!.animations[0]!.id).not.toBe(first!.animations[0]!.id);
    expect(copy!.animations[0]!.objectId).toBe(id);
    expect(state().currentSlideIndex).toBe(2);
  });

  it("deleteSlide removes it and keeps the selection in range", () => {
    state().addSlide();
    state().addSlide();
    state().selectSlide(2);
    state().deleteSlide(2);
    expect(state().slides).toHaveLength(2);
    expect(state().currentSlideIndex).toBe(1);
  });

  it("refuses to delete the only slide — a plan is its slides", () => {
    expect(state().slides).toHaveLength(1);
    state().deleteSlide(0);
    expect(state().slides).toHaveLength(1);
    expect(state().currentSlideIndex).toBe(0);
  });

  it("moveSlide reorders and ignores out-of-range targets", () => {
    state().addSlide();
    const [a, b] = state().slides.map((s) => s.id);
    state().moveSlide(0, 1);
    expect(state().slides.map((s) => s.id)).toEqual([b, a]);
    state().moveSlide(0, 5); // out of range → no-op
    expect(state().slides.map((s) => s.id)).toEqual([b, a]);
  });

  it("selectSlide clamps to the valid range, which never goes negative", () => {
    state().addSlide();
    state().selectSlide(99);
    expect(state().currentSlideIndex).toBe(1);
    state().selectSlide(-99);
    expect(state().currentSlideIndex).toBe(0);
  });
});

describe("slides — edits land on one slide and no other", () => {
  /**
   * The regression test for the whole model. Under the old cascading overrides
   * an edit on slide 1 carried forward into every later slide that hadn't
   * restated the field — which is exactly the confusion slides removed.
   */
  it("editing one slide leaves every other slide alone", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const home = at(id, 0);
    state().continueSlide(0); // slide 1
    state().continueSlide(1); // slide 2
    state().selectSlide(1);
    state().moveObject(id, 500, 400);

    expect(at(id, 0)).toMatchObject({ x: home.x, y: home.y });
    expect(at(id, 1)).toMatchObject({ x: 500, y: 400 });
    expect(at(id, 2)).toMatchObject({ x: home.x, y: home.y });
  });

  it("a new object joins the slide being edited, and no other", () => {
    // The point of the whole change: adding a token while writing slide 3 is
    // about slide 3. Slides 1 and 2 are other scenes and are left alone.
    state().addSlide();
    state().addSlide();
    state().selectSlide(2);
    const id = state().addIcon(iconId, { x: 100, y: 100 });

    expect(
      state().slides.map((slide) => slide.states[id] !== undefined),
    ).toEqual([false, false, true]);
    expect(at(id, 0).visible).toBe(false);
    expect(at(id, 1).visible).toBe(false);
    expect(at(id, 2).visible).toBe(true);
  });

  it("writes the object's position into the slide, not onto its base", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const base = { ...state().objects[id]!.base };
    state().continueSlide(0);
    state().moveObject(id, 500, 400);

    // `base` is the creation seed and stops being read once slides exist.
    expect(state().objects[id]!.base).toMatchObject({ x: base.x, y: base.y });
    expect(state().slides[1]!.states[id]).toMatchObject({ x: 500, y: 400 });
    expect(at(id, 1)).toMatchObject({ x: 500, y: 400 });
  });

  it("splits a patch: transforms follow the slide, tint/label stay on the object", () => {
    const id = state().addIcon(iconId);
    state().continueSlide(0);
    state().updateObject(id, { opacity: 0.25, label: "MT", tint: "#ff0000" });

    // Slide-independent properties belong to the object…
    expect(state().objects[id]!.base).toMatchObject({
      label: "MT",
      tint: "#ff0000",
      opacity: 1,
    });
    // …while the per-slide ones land in the slide.
    expect(state().slides[1]!.states[id]).toMatchObject({ opacity: 0.25 });
  });

  it("nudges from where the object appears on this slide", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().continueSlide(0);
    state().moveObject(id, 500, 500);
    state().select([id]);
    state().nudgeSelected(1, 0);

    expect(state().slides[1]!.states[id]).toMatchObject({ x: 501 });
  });

  it("a clone lands where the original appears on the current slide", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().continueSlide(0);
    state().moveObject(id, 800, 600);
    state().select([id]);

    const [cloneId] = state().duplicateSelected();
    // The copy lands beside where the original *visibly is* on this slide.
    expect(at(cloneId!, 1).x).toBeCloseTo(800 + 20);
  });
});

describe("slides — deleting an object cleans up after itself", () => {
  it("takes it out of this scene, and leaves the others alone", () => {
    // Delete means what it means in PowerPoint: the copy on the next slide is a
    // different appearance of the object, and isn't what you pointed at.
    const id = state().addIcon(iconId);
    const other = state().addIcon(iconId);
    state().continueSlide(0);
    state().addAnimation(1, id);
    state().addAnimation(1, other);
    state().selectSlide(1);

    state().deleteObjects([id]);

    expect(state().slides[0]!.states[id]).toBeDefined();
    expect(state().slides[1]!.states[id]).toBeUndefined();
    expect(state().slides[1]!.states[other]).toBeDefined();
    // Its animation on this slide goes with it — an animation is about an
    // object being in the scene.
    expect(state().slides[1]!.animations.map((a) => a.objectId)).toEqual([
      other,
    ]);
    // Still a plan object, because slide 1 still has it.
    expect(state().objects[id]).toBeDefined();
  });

  it("drops the object entirely once no slide has it", () => {
    const id = state().addIcon(iconId);
    state().addAnimation(0, id);

    state().deleteObjects([id]);

    expect(state().objects[id]).toBeUndefined();
    expect(state().objectIds).not.toContain(id);
    expect(state().slides[0]!.animations).toEqual([]);
  });
});

describe("slides — bringing an object into another scene", () => {
  it("pastes the same object onto a slide it wasn't on", () => {
    // Not a copy: a `move` animates one object across two slides, so the two
    // scenes have to hold the *same* token for the token to have moved.
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().select([id]);
    state().copySelected();
    state().addSlide();

    const pasted = state().paste();

    expect(pasted).toEqual([id]);
    expect(state().objectIds).toEqual([id]);
    expect(at(id, 1)).toMatchObject({ x: at(id, 0).x, visible: true });
  });

  it("still copies when the object is already in the scene", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().select([id]);
    state().copySelected();

    const pasted = state().paste();

    expect(pasted[0]).not.toBe(id);
    expect(state().objectIds).toHaveLength(2);
  });
});

/**
 * The attack designer is the one editor where the slides are *not* separate
 * scenes: a def is one thing in two states, laid out as Start and End, so a part
 * drawn on either belongs to both.
 */
describe("slides — a shared cast", () => {
  it("puts a new object on every slide", () => {
    state().continueSlide(0);
    state().setSharedCast(true);
    state().selectSlide(0);

    const id = state().addIcon(iconId);

    expect(state().slides.map((s) => s.states[id] !== undefined)).toEqual([
      true,
      true,
    ]);
    state().setSharedCast(false);
  });

  it("takes a deleted object off every slide", () => {
    state().continueSlide(0);
    state().setSharedCast(true);
    const id = state().addIcon(iconId);

    state().deleteObjects([id]);

    expect(state().slides.some((s) => s.states[id])).toBe(false);
    expect(state().objects[id]).toBeUndefined();
    state().setSharedCast(false);
  });
});

describe("animations — CRUD", () => {
  it("addAnimation adds a sensible default animation", () => {
    const id = state().addIcon(iconId);
    state().addSlide();
    const animId = state().addAnimation(0, id);

    const anim = state().slides[0]!.animations[0]!;
    expect(anim.id).toBe(animId);
    expect(anim).toMatchObject({
      objectId: id,
      kind: "motion",
      effect: "move",
      trigger: "onEnter",
    });
    expect(anim.durationMs).toBeGreaterThan(0);
  });

  it("refuses to animate an unknown object or slide", () => {
    state().addIcon(iconId);
    expect(state().addAnimation(9, "ghost")).toBeUndefined();
    expect(state().addAnimation(0, "ghost")).toBeUndefined();
    expect(state().slides[0]!.animations).toEqual([]);
  });

  it("updateAnimation patches fields", () => {
    const id = state().addIcon(iconId);
    state().addSlide();
    const animId = state().addAnimation(0, id)!;
    state().updateAnimation(0, animId, { effect: "fade", durationMs: 1200 });
    expect(state().slides[0]!.animations[0]).toMatchObject({
      effect: "fade",
      durationMs: 1200,
    });
  });

  it("deleteAnimation removes only that animation", () => {
    const id = state().addIcon(iconId);
    state().addSlide();
    const a = state().addAnimation(0, id)!;
    state().addAnimation(0, id);
    state().deleteAnimation(0, a);
    expect(state().slides[0]!.animations).toHaveLength(1);
    expect(state().slides[0]!.animations[0]!.id).not.toBe(a);
  });
});

describe("slides — history", () => {
  it("undoes adding a slide", () => {
    state().addSlide();
    expect(state().slides).toHaveLength(2);
    temporalStore.getState().undo();
    expect(state().slides).toHaveLength(1);
  });

  it("undoes a move written on a slide", () => {
    const id = state().addIcon(iconId, { x: 0, y: 0 });
    state().continueSlide(0);
    state().moveObject(id, 500, 500);
    expect(at(id, 1)).toMatchObject({ x: 500 });

    temporalStore.getState().undo();
    expect(at(id, 1)).not.toMatchObject({ x: 500 });
  });

  it("does not record slide *selection* as history", () => {
    state().addSlide();
    const depth = temporalStore.getState().pastStates.length;
    state().selectSlide(0);
    state().selectSlide(1);
    expect(temporalStore.getState().pastStates.length).toBe(depth);
  });
});

/**
 * Animating a selection is one action, not a loop: a group of six objects has
 * to undo in one press, and the animations have to land in document order
 * rather than in click order.
 */
describe("animateSelection", () => {
  const seed = () => {
    const a = state().addPrimitive("shape", "circle");
    const b = state().addPrimitive("shape", "circle");
    return { a, b };
  };

  it("gives every selected object the same animation", () => {
    const { a, b } = seed();
    state().select([a, b]);

    const ids = state().animateSelection(0);

    expect(ids).toHaveLength(2);
    expect(state().slides[0]!.animations.map((x) => x.objectId)).toEqual([
      a,
      b,
    ]);
    // Identical defaults: "the same animation to each" is the whole point.
    expect(state().slides[0]!.animations.map((x) => x.effect)).toEqual([
      "move",
      "move",
    ]);
  });

  it("lands them in document order, not the order they were clicked", () => {
    const { a, b } = seed();
    state().select([b]);
    state().toggleSelect(a);

    state().animateSelection(0);

    expect(state().slides[0]!.animations.map((x) => x.objectId)).toEqual([
      a,
      b,
    ]);
  });

  it("undoes in one press", () => {
    const { a, b } = seed();
    state().select([a, b]);
    clearHistory();

    state().animateSelection(0);
    expect(state().slides[0]!.animations).toHaveLength(2);

    temporalStore.getState().undo();
    expect(state().slides[0]!.animations).toHaveLength(0);
  });

  it("does nothing without a selection or a slide", () => {
    const { a } = seed();
    state().clearSelection();
    expect(state().animateSelection(0)).toEqual([]);
    state().select([a]);
    expect(state().animateSelection(9)).toEqual([]);
    expect(state().slides[0]!.animations).toHaveLength(0);
  });
});
