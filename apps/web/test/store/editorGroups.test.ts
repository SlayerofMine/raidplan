import { beforeEach, describe, expect, it } from "vitest";
import {
  clearHistory,
  temporalStore,
  useEditorStore,
} from "../../src/store/editorStore";
import { MIN_OBJECT_SIZE } from "../../src/editor/canvas/coords";

/**
 * Grouping (plan §18.1). A group is just objects sharing a `groupId`, and
 * selecting any member selects them all — which is what makes the existing
 * multi-node transformer move a group rigidly, with no extra maths.
 */
const state = () => useEditorStore.getState();

/** Three objects, so a group can be partial. */
function threeObjects(): [string, string, string] {
  const a = state().addPrimitive("shape", "circle");
  const b = state().addPrimitive("shape", "rect");
  const c = state().addPrimitive("shape", "cone");
  return [a, b, c];
}

/** Put an object in a known box, so the arithmetic in the tests is readable. */
const place = (id: string, x: number, y: number) =>
  state().updateObject(id, { x, y, w: 40, h: 40, rotation: 0 });

/** A box in that same shape — where a gesture left one of them. */
const square = (x: number, y: number, rotation: number) => ({
  x,
  y,
  w: 40,
  h: 40,
  rotation,
});

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  clearHistory();
});

describe("groupSelected", () => {
  it("ties the selection together under one id", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected();

    expect(groupId).toBeDefined();
    expect(state().objects[a]!.groupId).toBe(groupId);
    expect(state().objects[b]!.groupId).toBe(groupId);
  });

  it("refuses a selection of fewer than two", () => {
    const [a] = threeObjects();
    state().select([a]);
    expect(state().groupSelected()).toBeUndefined();
    expect(state().objects[a]!.groupId).toBeUndefined();
  });

  it("absorbs a whole existing group when one of its members is included", () => {
    const [a, b, c] = threeObjects();
    state().select([a, b]);
    const first = state().groupSelected();

    // Selecting b expands to its group, so grouping with c merges all three —
    // you can never half-group an existing group.
    state().select([b, c]);
    const second = state().groupSelected();

    expect(second).not.toBe(first);
    for (const id of [a, b, c]) {
      expect(state().objects[id]!.groupId).toBe(second);
    }
  });
});

describe("selection expands to the whole group", () => {
  it("selects every member when one is clicked", () => {
    const [a, b, c] = threeObjects();
    state().select([a, b]);
    state().groupSelected();

    state().select([a]);
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());
    expect(state().selectedIds).not.toContain(c);
  });

  it("toggles a group as a unit rather than member by member", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    state().groupSelected();

    state().clearSelection();
    state().toggleSelect(a);
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());

    // Toggling any member again drops the whole group.
    state().toggleSelect(b);
    expect(state().selectedIds).toEqual([]);
  });

  it("leaves ungrouped objects alone", () => {
    const [a, , c] = threeObjects();
    state().select([c]);
    expect(state().selectedIds).toEqual([c]);
    expect(state().selectedIds).not.toContain(a);
  });
});

describe("ungroupSelected", () => {
  it("dissolves the group the selection belongs to", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    state().groupSelected();

    state().select([a]); // expands to the group
    state().ungroupSelected();

    expect(state().objects[a]!.groupId).toBeUndefined();
    expect(state().objects[b]!.groupId).toBeUndefined();
    // And a click now selects only what was clicked.
    state().select([a]);
    expect(state().selectedIds).toEqual([a]);
  });
});

describe("selectOnly", () => {
  it("reaches one member without its group", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    state().groupSelected();

    state().selectOnly([a]);
    expect(state().selectedIds).toEqual([a]);
    // And the group is still a group — narrowing down to one member is not
    // taking it apart.
    expect(state().objects[a]!.groupId).toBeDefined();
    state().select([a]);
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());
  });

  it("drops anything that isn't in this scene", () => {
    const [a] = threeObjects();
    state().addSlide();
    state().selectOnly([a]);
    expect(state().selectedIds).toEqual([]);
  });
});

describe("selectGroup", () => {
  it("selects every member of the named group", () => {
    const [a, b, c] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;

    state().selectOnly([c]);
    state().selectGroup(groupId);
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());
  });
});

describe("names", () => {
  it("names a group, and clearing the name forgets it", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;

    state().renameGroup(groupId, "  Melee  ");
    expect(state().groups[groupId]).toBe("Melee");

    state().renameGroup(groupId, "   ");
    expect(state().groups[groupId]).toBeUndefined();
  });

  it("forgets the name when the group is dissolved", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;
    state().renameGroup(groupId, "Melee");

    state().ungroup(groupId);
    expect(state().groups[groupId]).toBeUndefined();
    expect(state().objects[a]!.groupId).toBeUndefined();
  });
});

describe("locking and hiding a whole group", () => {
  it("locks every member in one action", () => {
    const [a, b, c] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;

    state().setGroupLocked(groupId, true);
    expect(state().objects[a]!.locked).toBe(true);
    expect(state().objects[b]!.locked).toBe(true);
    // Never anything outside the group.
    expect(state().objects[c]!.locked).toBeUndefined();

    state().setGroupLocked(groupId, false);
    expect(state().objects[a]!.locked).toBe(false);
  });

  it("hides every member on the slide being edited, and no other", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;
    // A second slide holding the same two objects, where they stay visible.
    state().continueSlide(0);
    state().selectSlide(0);

    state().setGroupVisible(groupId, false);
    expect(state().slides[0]!.states[a]!.visible).toBe(false);
    expect(state().slides[0]!.states[b]!.visible).toBe(false);
    expect(state().slides[1]!.states[a]!.visible).toBe(true);
  });
});

describe("a group is never left with one member", () => {
  it("sets the last member loose when the others are deleted", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;
    state().renameGroup(groupId, "Melee");

    state().deleteObjects([a]);
    expect(state().objects[b]!.groupId).toBeUndefined();
    expect(state().groups[groupId]).toBeUndefined();
  });

  it("dissolves a group a merge has emptied out", () => {
    const [a, b, c] = threeObjects();
    state().select([a, b]);
    const first = state().groupSelected()!;
    state().renameGroup(first, "Melee");

    // Take one member out of that group and group it with c instead: the old
    // group is down to a single object, which is not a group.
    state().selectOnly([b, c]);
    const second = state().groupSelected()!;

    expect(state().objects[a]!.groupId).toBeUndefined();
    expect(state().objects[b]!.groupId).toBe(second);
    expect(state().groups[first]).toBeUndefined();
  });
});

describe("z-order", () => {
  it("gathers the members together at the front-most one", () => {
    const [a, b, c] = threeObjects();
    // a, b, c are back-to-front. Grouping the outer two pulls b out from
    // between them, so nothing sits inside the group.
    state().select([a, c]);
    state().groupSelected();

    expect(state().objectIds).toEqual([b, a, c]);
    // And `base.z` follows the order, as it must for the board to draw it.
    expect(state().objects[b]!.base.z).toBe(0);
    expect(state().objects[c]!.base.z).toBe(2);
  });
});

describe("animating a group", () => {
  it("gives every member the same animation in one action", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    state().groupSelected();

    // Clicking one member selects the group, so "animate the selection" is
    // already "animate the group" — there is no separate action to add.
    state().select([a]);
    const ids = state().animateSelection(0);

    expect(ids).toHaveLength(2);
    expect(
      state()
        .slides[0]!.animations.map((anim) => anim.objectId)
        .sort(),
    ).toEqual([a, b].sort());
  });
});

describe("settling a transform over several objects", () => {
  it("settles a hidden member along with the rest of its group", () => {
    const [a, b] = threeObjects();
    place(a, 100, 100);
    place(b, 300, 100);
    state().select([a, b]);
    state().groupSelected();
    // b is hidden on this slide, so the handles never attach to it — where it
    // goes is worked out from a, and written here.
    state().updateObject(b, { visible: false });

    state().applyTransforms([
      { id: a, ...square(100, 100, 90) },
      { id: b, ...square(100, 300, 90) },
    ]);

    const carried = state().slides[0]!.states[b]!;
    expect(carried.x).toBeCloseTo(100, 6);
    expect(carried.y).toBeCloseTo(300, 6);
    expect(carried.rotation).toBeCloseTo(90, 6);
    // Hidden is about what is drawn, not about where it is: still hidden.
    expect(carried.visible).toBe(false);
  });

  it("leaves a locked member where its author put it", () => {
    const [a, b] = threeObjects();
    place(b, 300, 100);
    state().select([a, b]);
    state().groupSelected();
    state().setLocked(b, true);

    state().applyTransforms([{ id: b, ...square(100, 100, 90) }]);

    expect(state().slides[0]!.states[b]!.x).toBeCloseTo(300, 6);
    expect(state().slides[0]!.states[b]!.rotation).toBeCloseTo(0, 6);
  });

  it("never squashes a member below the floor the handles enforce", () => {
    const [a] = threeObjects();
    state().applyTransforms([
      { id: a, x: 0, y: 0, w: 0.5, h: 0.5, rotation: 0 },
    ]);

    expect(state().slides[0]!.states[a]!.w).toBe(MIN_OBJECT_SIZE);
    expect(state().slides[0]!.states[a]!.h).toBe(MIN_OBJECT_SIZE);
  });

  it("writes to the slide being edited and no other", () => {
    const [a, b] = threeObjects();
    place(b, 300, 100);
    state().select([a, b]);
    state().groupSelected();
    state().continueSlide(0);
    state().selectSlide(0);

    state().applyTransforms([{ id: b, ...square(300, 100, 90) }]);

    expect(state().slides[0]!.states[b]!.rotation).toBeCloseTo(90, 6);
    expect(state().slides[1]!.states[b]!.rotation).toBeCloseTo(0, 6);
  });
});

/**
 * One gesture, one undo (plan §2.7). Dragging or turning a group of three is a
 * single thing the author did: taking it back must not mean three presses,
 * walking the group apart a member at a time on the way.
 */
describe("a gesture over several objects is one history entry", () => {
  it("folds a group drag into a single undo", () => {
    const [a, b, c] = threeObjects();
    state().select([a, b, c]);
    state().groupSelected();
    const before = { ...state().slides[0]!.states[a]! };
    clearHistory();

    state().moveObjects([
      { id: a, x: 500, y: 500 },
      { id: b, x: 540, y: 500 },
      { id: c, x: 580, y: 500 },
    ]);
    expect(temporalStore.getState().pastStates).toHaveLength(1);

    // And one press puts the whole group back, not just the last member.
    temporalStore.getState().undo();
    expect(state().slides[0]!.states[a]!.x).toBeCloseTo(before.x, 6);
    expect(state().slides[0]!.states[b]!.x).not.toBeCloseTo(540, 6);
    expect(state().slides[0]!.states[c]!.x).not.toBeCloseTo(580, 6);
  });

  it("folds a group transform into a single undo", () => {
    const [a, b, c] = threeObjects();
    state().select([a, b, c]);
    state().groupSelected();
    clearHistory();

    state().applyTransforms([
      { id: a, ...square(100, 100, 45) },
      { id: b, ...square(140, 100, 45) },
      { id: c, ...square(180, 100, 45) },
    ]);
    expect(temporalStore.getState().pastStates).toHaveLength(1);

    temporalStore.getState().undo();
    expect(state().slides[0]!.states[a]!.rotation).toBe(0);
    expect(state().slides[0]!.states[c]!.rotation).toBe(0);
  });

  it("leaves no entry when a gesture moved nothing", () => {
    const [a, b] = threeObjects();
    const at = state().slides[0]!.states[a]!;
    clearHistory();

    // A click on a handle that never moved: the same values written back.
    state().moveObjects([{ id: a, x: at.x, y: at.y }]);
    state().applyTransforms([{ id: b, ...state().slides[0]!.states[b]! }]);
    expect(temporalStore.getState().pastStates).toHaveLength(0);
  });
});

describe("round-trip", () => {
  it("carries groups through the serialized document", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected();

    const plan = state().getPlan();
    expect(plan.objects.find((o) => o.id === a)!.groupId).toBe(groupId);
  });

  it("carries the group's name, and reloads it", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;
    state().renameGroup(groupId, "Melee");

    const plan = state().getPlan();
    expect(plan.groups[groupId]).toBe("Melee");

    state().reset();
    expect(state().groups).toEqual({});
    state().loadPlan(plan);
    expect(state().groups[groupId]).toBe("Melee");
    state().select([a]);
    expect([...state().selectedIds].sort()).toEqual([a, b].sort());
  });

  it("drops a name whose group no longer has members on load", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected()!;
    state().renameGroup(groupId, "Melee");
    const plan = state().getPlan();

    // A document from outside the store can disagree with itself; the load is
    // where that is repaired, exactly as it is for slide states.
    const tampered = {
      ...plan,
      objects: plan.objects.map((o) => ({ ...o, groupId: undefined })),
    };
    state().loadPlan(tampered);
    expect(state().groups[groupId]).toBeUndefined();
  });
});
