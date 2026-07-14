import { beforeEach, describe, expect, it } from "vitest";
import { ICONS } from "../assets/icons";
import { useEditorStore } from "./editorStore";

const iconId = ICONS[0]!.id;
const state = () => useEditorStore.getState();

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
});

describe("editorStore — objects", () => {
  it("addIcon adds a normalized object and selects it", () => {
    const id = state().addIcon(iconId);
    expect(state().objectIds).toEqual([id]);
    expect(state().objects[id]?.iconId).toBe(iconId);
    expect(state().selectedId).toBe(id);
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

  it("stacks objects with increasing z in insertion order", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    expect(state().objects[a]!.base.z).toBe(0);
    expect(state().objects[b]!.base.z).toBe(1);
    expect(state().objectIds).toEqual([a, b]);
  });

  it("moveObject updates coordinates", () => {
    const id = state().addIcon(iconId);
    state().moveObject(id, 42, 84);
    expect(state().objects[id]).toMatchObject({ base: { x: 42, y: 84 } });
  });

  it("moveObject on a missing id is a no-op", () => {
    state().addIcon(iconId);
    const before = structuredClone(state().objects);
    state().moveObject("nope", 1, 2);
    expect(state().objects).toEqual(before);
  });

  it("deleteObject removes it and clears the selection", () => {
    const id = state().addIcon(iconId);
    state().deleteObject(id);
    expect(state().objectIds).toEqual([]);
    expect(state().objects[id]).toBeUndefined();
    expect(state().selectedId).toBeNull();
  });

  it("deleteSelected removes only the selected object", () => {
    const a = state().addIcon(iconId);
    const b = state().addIcon(iconId);
    state().selectObject(a);
    state().deleteSelected();
    expect(state().objectIds).toEqual([b]);
  });

  it("deleteSelected with no selection is a no-op", () => {
    const a = state().addIcon(iconId);
    state().selectObject(null);
    state().deleteSelected();
    expect(state().objectIds).toEqual([a]);
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
    const { view } = state();
    expect(view.scale).toBeGreaterThan(0);
    expect(view.scale).toBeLessThan(0.5); // 1600x900 into 800x450 (with padding)
  });

  it("zoomAtPoint scales about the focal point", () => {
    state().setView({ scale: 1, x: 0, y: 0 });
    state().zoomAtPoint({ x: 100, y: 100 }, 2);
    expect(state().view.scale).toBe(2);
  });
});
