import { beforeEach, describe, expect, it } from "vitest";
import { resolveObjectState } from "@raidplan/shared";
import { ICONS } from "@raidplan/shared";
import {
  BASE_STEP_INDEX,
  clearHistory,
  temporalStore,
  useEditorStore,
} from "../../src/store/editorStore";

const iconId = ICONS[0]!.id;
const state = () => useEditorStore.getState();
/** The state an object resolves to on a given step. */
const at = (id: string, stepIndex: number) =>
  resolveObjectState(state().objects[id]!, state().steps, stepIndex);

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().setSnapEnabled(false);
  clearHistory();
});

describe("steps — CRUD", () => {
  it("starts on the base layout with no steps", () => {
    expect(state().steps).toEqual([]);
    expect(state().currentStepIndex).toBe(BASE_STEP_INDEX);
  });

  it("addStep appends and selects the new step", () => {
    state().addStep();
    expect(state().steps).toHaveLength(1);
    expect(state().currentStepIndex).toBe(0);
    state().addStep();
    expect(state().steps).toHaveLength(2);
    expect(state().currentStepIndex).toBe(1);
  });

  it("duplicateStep copies overrides and gives animations fresh ids", () => {
    const id = state().addIcon(iconId);
    state().addStep();
    state().moveObject(id, 500, 500);
    state().addAnimation(0, id);

    state().duplicateStep(0);
    expect(state().steps).toHaveLength(2);
    const [first, copy] = state().steps;
    expect(copy!.overrides).toEqual(first!.overrides);
    expect(copy!.id).not.toBe(first!.id);
    expect(copy!.animations[0]!.id).not.toBe(first!.animations[0]!.id);
    expect(copy!.animations[0]!.objectId).toBe(id);
    expect(state().currentStepIndex).toBe(1);
  });

  it("deleteStep removes it and keeps the selection in range", () => {
    state().addStep();
    state().addStep();
    state().selectStep(1);
    state().deleteStep(1);
    expect(state().steps).toHaveLength(1);
    expect(state().currentStepIndex).toBe(0);
  });

  it("deleting the last step falls back to the base layout", () => {
    state().addStep();
    state().deleteStep(0);
    expect(state().currentStepIndex).toBe(BASE_STEP_INDEX);
  });

  it("moveStep reorders and ignores out-of-range targets", () => {
    state().addStep();
    state().addStep();
    const [a, b] = state().steps.map((s) => s.id);
    state().moveStep(0, 1);
    expect(state().steps.map((s) => s.id)).toEqual([b, a]);
    state().moveStep(0, 5); // out of range → no-op
    expect(state().steps.map((s) => s.id)).toEqual([b, a]);
  });

  it("selectStep clamps to the valid range", () => {
    state().addStep();
    state().selectStep(99);
    expect(state().currentStepIndex).toBe(0);
    state().selectStep(-99);
    expect(state().currentStepIndex).toBe(BASE_STEP_INDEX);
  });
});

describe("steps — edits are routed to the right place", () => {
  it("edits on the base layout write to the object's base", () => {
    const id = state().addIcon(iconId);
    state().selectStep(BASE_STEP_INDEX);
    state().moveObject(id, 111, 222);

    expect(state().objects[id]!.base).toMatchObject({ x: 111, y: 222 });
    expect(state().steps).toEqual([]);
  });

  it("edits on a step write an override, leaving the base untouched", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    const base = { ...state().objects[id]!.base };
    state().addStep();
    state().moveObject(id, 500, 400);

    // The base is the *start* of the step; the override is its end state.
    expect(state().objects[id]!.base).toMatchObject({ x: base.x, y: base.y });
    expect(state().steps[0]!.overrides[id]).toMatchObject({ x: 500, y: 400 });
    expect(at(id, BASE_STEP_INDEX)).toMatchObject({ x: base.x, y: base.y });
    expect(at(id, 0)).toMatchObject({ x: 500, y: 400 });
  });

  it("splits a patch: transforms follow the step, tint/label stay on the base", () => {
    const id = state().addIcon(iconId);
    state().addStep();
    state().updateObject(id, { opacity: 0.25, label: "MT", tint: "#ff0000" });

    // Step-independent properties always live on the base…
    expect(state().objects[id]!.base).toMatchObject({
      label: "MT",
      tint: "#ff0000",
      opacity: 1,
    });
    // …while overridable ones land in the step.
    expect(state().steps[0]!.overrides[id]).toEqual({ opacity: 0.25 });
  });

  it("accumulates overrides across steps", () => {
    const id = state().addIcon(iconId, { x: 0, y: 0 });
    state().addStep();
    state().moveObject(id, 100, 0);
    state().addStep();
    state().moveObject(id, 300, 50);

    expect(at(id, 0)).toMatchObject({ x: 100, y: 0 });
    expect(at(id, 1)).toMatchObject({ x: 300, y: 50 });
  });

  it("nudges from where the object appears on the step, not its base", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().addStep();
    state().moveObject(id, 500, 500);
    state().select([id]);
    state().nudgeSelected(1, 0);

    expect(state().steps[0]!.overrides[id]).toMatchObject({ x: 501 });
  });

  it("a clone lands where the original appears on the current step", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().addStep();
    state().moveObject(id, 800, 600);

    const [cloneId] = state().duplicateSelected();
    // The copy's base is the *visible* position, not the original's base.
    expect(state().objects[cloneId!]!.base.x).toBeCloseTo(800 + 20);
  });
});

describe("steps — deleting an object cleans up after itself", () => {
  it("drops its overrides and animations from every step", () => {
    const id = state().addIcon(iconId);
    const other = state().addIcon(iconId);
    state().addStep();
    state().moveObject(id, 500, 500);
    state().moveObject(other, 100, 100);
    state().addAnimation(0, id);
    state().addAnimation(0, other);

    state().deleteObjects([id]);

    expect(state().steps[0]!.overrides[id]).toBeUndefined();
    expect(state().steps[0]!.overrides[other]).toBeDefined();
    expect(state().steps[0]!.animations.map((a) => a.objectId)).toEqual([
      other,
    ]);
  });
});

describe("animations — CRUD", () => {
  it("addAnimation adds a sensible default animation", () => {
    const id = state().addIcon(iconId);
    state().addStep();
    const animId = state().addAnimation(0, id);

    const anim = state().steps[0]!.animations[0]!;
    expect(anim.id).toBe(animId);
    expect(anim).toMatchObject({
      objectId: id,
      kind: "motion",
      effect: "move",
      trigger: "onEnter",
    });
    expect(anim.durationMs).toBeGreaterThan(0);
  });

  it("refuses to animate an unknown object or step", () => {
    const id = state().addIcon(iconId);
    expect(state().addAnimation(0, id)).toBeUndefined(); // no such step
    state().addStep();
    expect(state().addAnimation(0, "ghost")).toBeUndefined();
    expect(state().steps[0]!.animations).toEqual([]);
  });

  it("updateAnimation patches fields", () => {
    const id = state().addIcon(iconId);
    state().addStep();
    const animId = state().addAnimation(0, id)!;
    state().updateAnimation(0, animId, { effect: "fade", durationMs: 1200 });
    expect(state().steps[0]!.animations[0]).toMatchObject({
      effect: "fade",
      durationMs: 1200,
    });
  });

  it("deleteAnimation removes only that animation", () => {
    const id = state().addIcon(iconId);
    state().addStep();
    const a = state().addAnimation(0, id)!;
    state().addAnimation(0, id);
    state().deleteAnimation(0, a);
    expect(state().steps[0]!.animations).toHaveLength(1);
    expect(state().steps[0]!.animations[0]!.id).not.toBe(a);
  });
});

describe("steps — history", () => {
  it("undoes adding a step", () => {
    state().addStep();
    expect(state().steps).toHaveLength(1);
    temporalStore.getState().undo();
    expect(state().steps).toHaveLength(0);
  });

  it("undoes an override written on a step", () => {
    const id = state().addIcon(iconId, { x: 0, y: 0 });
    state().addStep();
    state().moveObject(id, 500, 500);
    expect(at(id, 0)).toMatchObject({ x: 500 });

    temporalStore.getState().undo();
    expect(state().steps[0]!.overrides[id]).toBeUndefined();
  });

  it("does not record step *selection* as history", () => {
    state().addStep();
    const depth = temporalStore.getState().pastStates.length;
    state().selectStep(BASE_STEP_INDEX);
    state().selectStep(0);
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
    state().addStep();
    return { a, b };
  };

  it("gives every selected object the same animation", () => {
    const { a, b } = seed();
    state().select([a, b]);

    const ids = state().animateSelection(0);

    expect(ids).toHaveLength(2);
    expect(state().steps[0]!.animations.map((x) => x.objectId)).toEqual([a, b]);
    // Identical defaults: "the same animation to each" is the whole point.
    expect(state().steps[0]!.animations.map((x) => x.effect)).toEqual([
      "move",
      "move",
    ]);
  });

  it("lands them in document order, not the order they were clicked", () => {
    const { a, b } = seed();
    state().select([b]);
    state().toggleSelect(a);

    state().animateSelection(0);

    expect(state().steps[0]!.animations.map((x) => x.objectId)).toEqual([a, b]);
  });

  it("undoes in one press", () => {
    const { a, b } = seed();
    state().select([a, b]);
    clearHistory();

    state().animateSelection(0);
    expect(state().steps[0]!.animations).toHaveLength(2);

    temporalStore.getState().undo();
    expect(state().steps[0]!.animations).toHaveLength(0);
  });

  it("does nothing without a selection or a step", () => {
    const { a } = seed();
    state().clearSelection();
    expect(state().animateSelection(0)).toEqual([]);
    state().select([a]);
    expect(state().animateSelection(9)).toEqual([]);
    expect(state().steps[0]!.animations).toHaveLength(0);
  });
});
