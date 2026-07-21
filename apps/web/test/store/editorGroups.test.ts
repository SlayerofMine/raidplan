import { beforeEach, describe, expect, it } from "vitest";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

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

describe("round-trip", () => {
  it("carries groups through the serialized document", () => {
    const [a, b] = threeObjects();
    state().select([a, b]);
    const groupId = state().groupSelected();

    const plan = state().getPlan();
    expect(plan.objects.find((o) => o.id === a)!.groupId).toBe(groupId);
  });
});
