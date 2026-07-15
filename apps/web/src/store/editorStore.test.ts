import { beforeEach, describe, expect, it } from "vitest";
import { ICONS } from "@raidplan/shared";
import { clearHistory, temporalStore, useEditorStore } from "./editorStore";

const iconId = ICONS[0]!.id;
const state = () => useEditorStore.getState();

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().setSnapEnabled(false);
  clearHistory();
});

describe("editorStore — creation", () => {
  it("addIcon adds a normalized object and selects it", () => {
    const id = state().addIcon(iconId);
    expect(state().objectIds).toEqual([id]);
    expect(state().objects[id]?.iconId).toBe(iconId);
    expect(state().selectedIds).toEqual([id]);
  });

  it("centres the object on the background before the stage is measured", () => {
    const id = state().addIcon(iconId);
    const o = state().objects[id]!;
    const { background } = state();
    expect(o.base.x + o.base.w / 2).toBeCloseTo(background.width / 2);
    expect(o.base.y + o.base.h / 2).toBeCloseTo(background.height / 2);
  });

  it("places an object at an explicit native point", () => {
    const id = state().addIcon(iconId, { x: 500, y: 300 });
    const o = state().objects[id]!;
    expect(o.base.x + o.base.w / 2).toBeCloseTo(500);
    expect(o.base.y + o.base.h / 2).toBeCloseTo(300);
  });

  it("applies a class/role icon's tint so the token gets its colour ring", () => {
    const classIcon = ICONS.find((i) => i.category === "class")!;
    const id = state().addIcon(classIcon.id);
    expect(state().objects[id]!.base.tint).toBe(classIcon.tint);
  });

  it("addPrimitive creates typed shapes", () => {
    const rect = state().addPrimitive("shape", "rect");
    const text = state().addPrimitive("text");
    expect(state().objects[rect]).toMatchObject({
      type: "shape",
      shape: "rect",
    });
    expect(state().objects[text]).toMatchObject({ type: "text" });
    expect(state().objects[text]!.base.label).toBe("Text");
  });

  it("stacks objects with increasing z in insertion order", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    expect(state().objects[a]!.base.z).toBe(0);
    expect(state().objects[b]!.base.z).toBe(1);
    expect(state().objectIds).toEqual([a, b]);
  });
});

describe("editorStore — mutation", () => {
  it("updateObject patches only the given properties", () => {
    const id = state().addIcon(iconId);
    state().updateObject(id, { opacity: 0.5, label: "MT" });
    const o = state().objects[id]!;
    expect(o.base.opacity).toBe(0.5);
    expect(o.base.label).toBe("MT");
    expect(o.base.visible).toBe(true); // untouched
  });

  it("moveObject updates coordinates", () => {
    const id = state().addIcon(iconId);
    state().moveObject(id, 42, 84);
    expect(state().objects[id]).toMatchObject({ base: { x: 42, y: 84 } });
  });

  it("moveObject snaps to the grid when snapping is enabled", () => {
    const id = state().addIcon(iconId);
    state().setSnapEnabled(true);
    state().moveObject(id, 47, 82);
    // default grid is 40 → nearest multiples are 40 and 80
    expect(state().objects[id]).toMatchObject({ base: { x: 40, y: 80 } });
  });

  it("moveObject on a missing id is a no-op", () => {
    state().addIcon(iconId);
    const before = structuredClone(state().objects);
    state().moveObject("nope", 1, 2);
    expect(state().objects).toEqual(before);
  });

  it("does not move a locked object", () => {
    const id = state().addIcon(iconId);
    const { x, y } = state().objects[id]!.base;
    state().setLocked(id, true);
    state().moveObject(id, 999, 999);
    expect(state().objects[id]).toMatchObject({ base: { x, y } });
  });

  it("nudgeSelected offsets every selected object", () => {
    const a = state().addIcon(iconId, { x: 100, y: 100 });
    const b = state().addIcon(iconId, { x: 200, y: 100 });
    state().select([a, b]);
    state().nudgeSelected(1, 0);
    expect(state().objects[a]!.base.x).toBe(68 + 1); // 100 - 64/2 = 68
    expect(state().objects[b]!.base.x).toBe(168 + 1);
  });

  it("duplicateSelected clones with new ids, offset and selected", () => {
    const id = state().addIcon(iconId);
    state().updateObject(id, { opacity: 0.4, rotation: 30 });
    const [cloneId] = state().duplicateSelected();
    expect(cloneId).toBeDefined();
    expect(cloneId).not.toBe(id);
    expect(state().objectIds).toHaveLength(2);
    expect(state().selectedIds).toEqual([cloneId]);
    const original = state().objects[id]!;
    const clone = state().objects[cloneId!]!;
    expect(clone.base.x).toBe(original.base.x + 20);
    expect(clone.base.opacity).toBe(0.4);
    expect(clone.base.rotation).toBe(30);
  });

  it("duplicateSelected with no selection is a no-op", () => {
    expect(state().duplicateSelected()).toEqual([]);
    expect(state().objectIds).toEqual([]);
  });

  it("copy/paste adds an offset copy and selects it", () => {
    const id = state().addIcon(iconId, { x: 100, y: 100 });
    state().updateObject(id, { label: "MT" });
    state().copySelected();

    const [pastedId] = state().paste();
    expect(state().objectIds).toHaveLength(2);
    expect(state().selectedIds).toEqual([pastedId]);
    expect(state().objects[pastedId!]!.base.label).toBe("MT");
    expect(state().objects[pastedId!]!.base.x).toBe(
      state().objects[id]!.base.x + 20,
    );
  });

  it("paste can be repeated from one copy", () => {
    state().addIcon(iconId);
    state().copySelected();
    state().paste();
    state().paste();
    expect(state().objectIds).toHaveLength(3);
  });

  it("the clipboard snapshots the object, so later edits don't leak in", () => {
    const id = state().addIcon(iconId);
    state().copySelected();
    state().updateObject(id, { label: "changed after copy" });

    const [pastedId] = state().paste();
    expect(state().objects[pastedId!]!.base.label).toBeUndefined();
  });

  it("paste with an empty clipboard is a no-op", () => {
    expect(state().paste()).toEqual([]);
    expect(state().objectIds).toEqual([]);
  });
});

describe("editorStore — deletion & selection", () => {
  it("deleteObjects removes them and drops them from the selection", () => {
    const id = state().addIcon(iconId);
    state().deleteObjects([id]);
    expect(state().objectIds).toEqual([]);
    expect(state().objects[id]).toBeUndefined();
    expect(state().selectedIds).toEqual([]);
  });

  it("deleteSelected removes only the selected objects", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    state().select([a]);
    state().deleteSelected();
    expect(state().objectIds).toEqual([b]);
  });

  it("deleteSelected with no selection is a no-op", () => {
    const a = state().addIcon(iconId);
    state().clearSelection();
    state().deleteSelected();
    expect(state().objectIds).toEqual([a]);
  });

  it("reindexes z after a delete", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    const c = state().addIcon(iconId);
    state().deleteObjects([a]);
    expect(state().objects[b]!.base.z).toBe(0);
    expect(state().objects[c]!.base.z).toBe(1);
  });

  it("toggleSelect adds and removes from a multi-selection", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    state().select([a]);
    state().toggleSelect(b);
    expect(state().selectedIds).toEqual([a, b]);
    state().toggleSelect(b);
    expect(state().selectedIds).toEqual([a]);
  });

  it("select ignores unknown ids and selectAll takes everything", () => {
    const a = state().addIcon(iconId);
    state().select([a, "ghost"]);
    expect(state().selectedIds).toEqual([a]);
    state().addIcon(iconId);
    state().selectAll();
    expect(state().selectedIds).toEqual(state().objectIds);
  });
});

describe("editorStore — z-order", () => {
  it("bringForward / sendBackward move one step and clamp at the ends", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    const c = state().addIcon(iconId);

    state().bringForward(a);
    expect(state().objectIds).toEqual([b, a, c]);

    state().sendBackward(a);
    expect(state().objectIds).toEqual([a, b, c]);

    // already at the back — clamped, no throw
    state().sendBackward(a);
    expect(state().objectIds).toEqual([a, b, c]);
  });

  it("bringToFront / sendToBack jump to the ends and reindex z", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    const c = state().addIcon(iconId);

    state().bringToFront(a);
    expect(state().objectIds).toEqual([b, c, a]);
    expect(state().objects[a]!.base.z).toBe(2);

    state().sendToBack(a);
    expect(state().objectIds).toEqual([a, b, c]);
    expect(state().objects[a]!.base.z).toBe(0);
  });
});

describe("editorStore — undo/redo (zundo)", () => {
  it("undoes and redoes an add", () => {
    const id = state().addIcon(iconId);
    expect(state().objectIds).toEqual([id]);

    temporalStore.getState().undo();
    expect(state().objectIds).toEqual([]);

    temporalStore.getState().redo();
    expect(state().objectIds).toEqual([id]);
  });

  it("undoes a property change", () => {
    const id = state().addIcon(iconId);
    state().updateObject(id, { opacity: 0.2 });
    expect(state().objects[id]!.base.opacity).toBe(0.2);

    temporalStore.getState().undo();
    expect(state().objects[id]!.base.opacity).toBe(1);
  });

  it("does not record selection or camera changes as history", () => {
    const id = state().addIcon(iconId);
    const depth = temporalStore.getState().pastStates.length;

    state().select([id]);
    state().clearSelection();
    state().setView({ scale: 2, x: 10, y: 10 });
    state().setStageSize({ width: 100, height: 100 });

    expect(temporalStore.getState().pastStates.length).toBe(depth);
  });

  it("clearHistory drops the undo stack", () => {
    state().addIcon(iconId);
    expect(temporalStore.getState().pastStates.length).toBeGreaterThan(0);
    clearHistory();
    expect(temporalStore.getState().pastStates.length).toBe(0);
  });
});

describe("editorStore — view", () => {
  it("fitToStage is a no-op until the stage is measured", () => {
    state().fitToStage();
    expect(state().view).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("fitToStage scales the background down into a smaller stage", () => {
    state().setStageSize({ width: 800, height: 450 });
    state().fitToStage();
    expect(state().view.scale).toBeGreaterThan(0);
    expect(state().view.scale).toBeLessThan(0.5);
  });

  it("zoomAtPoint scales about the focal point", () => {
    state().setView({ scale: 1, x: 0, y: 0 });
    state().zoomAtPoint({ x: 100, y: 100 }, 2);
    expect(state().view.scale).toBe(2);
  });
});
