import { describe, expect, it } from "vitest";
import type { Stage } from "konva/lib/Stage";
import type { ObjectState } from "@raidplan/shared";
import { applyObjectState, readObjectState } from "../../src/anim/applyToStage";

/**
 * The seam between the animation engine and Konva (plan §8.1).
 *
 * Size is the interesting case: a `Group` is sized by its children, so an
 * animator can't set a width on it. It scales instead, against the size the
 * renderer says it drew — without which `scale` and the size half of `pulse`
 * did nothing at all while playing, since React isn't in the frame loop.
 */
function fakeNode(attrs: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = {
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 1,
    visible: true,
    scaleX: 1,
    scaleY: 1,
    ...attrs,
  };
  return {
    store,
    node: {
      setAttrs: (a: Record<string, unknown>) => Object.assign(store, a),
      getAttr: (k: string) => store[k],
      x: () => store["x"] as number,
      y: () => store["y"] as number,
      rotation: () => store["rotation"] as number,
      opacity: () => store["opacity"] as number,
      visible: () => store["visible"] as boolean,
      scaleX: () => store["scaleX"] as number,
      scaleY: () => store["scaleY"] as number,
    },
  };
}

const stageWith = (node: object) =>
  ({ findOne: () => node }) as unknown as Stage;

const state = (over: Partial<ObjectState> = {}): ObjectState => ({
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  ...over,
});

describe("applyObjectState", () => {
  it("writes only the properties it is given", () => {
    const { store, node } = fakeNode();
    applyObjectState(stageWith(node), "a", { x: 40 });
    expect(store["x"]).toBe(40);
    // A concurrent animation owns the rest; touching them would undo it.
    expect(store["opacity"]).toBe(1);
    expect(store["visible"]).toBe(true);
  });

  it("turns a size into a scale against the size the node was drawn at", () => {
    const { store, node } = fakeNode({ baseW: 100, baseH: 50 });
    applyObjectState(stageWith(node), "a", { w: 150, h: 200 });
    expect(store["scaleX"]).toBe(1.5);
    expect(store["scaleY"]).toBe(4);
  });

  it("leaves the node alone when it never said what size it was drawn at", () => {
    const { store, node } = fakeNode();
    applyObjectState(stageWith(node), "a", { w: 150 });
    // Better an unscaled node than one scaled by a made-up factor.
    expect(store["scaleX"]).toBe(1);
  });

  it("does nothing for an object with no node", () => {
    const stage = { findOne: () => undefined } as unknown as Stage;
    expect(() => applyObjectState(stage, "ghost", { x: 1 })).not.toThrow();
  });
});

describe("readObjectState", () => {
  it("reads the live size back through the scale", () => {
    const { node } = fakeNode({ baseW: 100, baseH: 100, scaleX: 2, scaleY: 3 });
    // A triggered animation starts from where the object *is*, mid-resize
    // included.
    expect(readObjectState(stageWith(node), "a", state())).toMatchObject({
      w: 200,
      h: 300,
    });
  });

  it("falls back to the given state when the node says nothing about size", () => {
    const { node } = fakeNode();
    expect(
      readObjectState(stageWith(node), "a", state({ w: 64 })),
    ).toMatchObject({ w: 64 });
  });
});
