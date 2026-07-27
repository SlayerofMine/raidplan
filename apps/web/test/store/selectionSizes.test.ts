import { beforeEach, describe, expect, it } from "vitest";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";
import { selectSelectionSizes } from "../../src/store/selectors";

/**
 * The signal that keeps the selection handles on a resized object (plan §2.2).
 *
 * Konva's `Transformer` re-measures when the node it is attached to changes
 * `width`/`height`, and an object's node is a `Group` carrying neither — its
 * size is on the children. So a committed resize is invisible to it, and the
 * handles stayed at the size the object started at until the selection was
 * rebuilt. `CanvasStage` watches this value instead and refreshes on it, so what
 * matters is exactly when it changes: on a size the transformer can't see, and
 * not on the ones it can.
 */
const state = () => useEditorStore.getState();
const sizes = () => selectSelectionSizes(useEditorStore.getState());

beforeEach(() => {
  state().reset();
  clearHistory();
});

describe("selectSelectionSizes", () => {
  it("changes when a selected object is resized", () => {
    const id = state().addPrimitive("shape", "rect");
    state().select([id]);

    const before = sizes();
    state().updateObject(id, { w: 250, h: 90 });
    expect(sizes()).not.toBe(before);
  });

  it("holds still for a move or a turn — the transformer hears those itself", () => {
    const id = state().addPrimitive("shape", "rect");
    state().select([id]);

    const before = sizes();
    state().updateObject(id, { x: 700, y: 400, rotation: 45, opacity: 0.5 });
    // `x`, `y` and `rotation` are attributes of the group Konva is attached to,
    // so refreshing on them would be needless work every drag and turn.
    expect(sizes()).toBe(before);
  });

  it("ignores a resize of something that isn't selected", () => {
    const selected = state().addPrimitive("shape", "rect");
    const other = state().addPrimitive("shape", "circle");
    state().select([selected]);

    const before = sizes();
    state().updateObject(other, { w: 500, h: 500 });
    expect(sizes()).toBe(before);
  });

  it("sees a resize that lands in a step's overrides, not the base", () => {
    const id = state().addPrimitive("shape", "rect");
    const stepId = state().addStep();
    state().selectStep(state().steps.findIndex((s) => s.id === stepId));
    state().select([id]);

    const before = sizes();
    // The editor edits the end state (plan §5), so this is written to the step —
    // the drawn size still changes, and the handles still have to follow.
    state().updateObject(id, { w: 250, h: 90 });
    expect(sizes()).not.toBe(before);
  });

  it("changes when stepping to a step that resizes the selection", () => {
    const id = state().addPrimitive("shape", "rect");
    const stepId = state().addStep();
    const stepIndex = state().steps.findIndex((s) => s.id === stepId);
    state().selectStep(stepIndex);
    state().updateObject(id, { w: 250, h: 90 });
    state().select([id]);

    const inStep = sizes();
    state().selectStep(-1);
    // Nothing was edited, but the object is drawn at a different size — so the
    // handles have to move even though no object changed.
    expect(sizes()).not.toBe(inStep);
  });

  it("covers every object in a multi-selection", () => {
    const a = state().addPrimitive("shape", "rect");
    const b = state().addPrimitive("shape", "circle");
    state().select([a, b]);

    const before = sizes();
    state().updateObject(b, { w: 250, h: 90 });
    expect(sizes()).not.toBe(before);
  });

  it("is empty with nothing selected — there are no handles to refresh", () => {
    state().addPrimitive("shape", "rect");
    state().clearSelection();
    expect(sizes()).toBe("");
  });
});
