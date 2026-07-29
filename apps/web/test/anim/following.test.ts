import { beforeEach, describe, expect, it } from "vitest";
import gsap from "gsap";
import { act, renderHook } from "@testing-library/react";
import type { Stage } from "konva/lib/Stage";
import {
  SCHEMA_VERSION,
  type ObjectBase,
  type Plan,
  type PlanObject,
} from "@raidplan/shared";
import { useFollowing } from "../../src/anim/useFollowing";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

/**
 * Things that follow other things (plan §18.17), driven on the real ticker.
 *
 * The runtime only ever talks to Konva through `findOne`, `setAttrs` and the
 * position accessors, so a handful of fake nodes stand in for the stage: the
 * tokens report boxes, and whatever follows them records what was written to it.
 * Moving a token and watching the cone turn is then an assertion rather than a
 * screenshot.
 */
function fakeNode(box: {
  x: number;
  y: number;
  rotation?: number;
  w?: number;
  h?: number;
}) {
  const { w = 40, h = 40, ...position } = box;
  // `baseW`/`baseH` plus a scale is how a size reaches a real node
  // (`applyToStage`), and the follow runtime reads its size back that way.
  const attrs: Record<string, unknown> = {
    rotation: 0,
    baseW: w,
    baseH: h,
    ...position,
  };
  const identity = {
    copy: () => identity,
    invert: () => identity,
    point: (p: { x: number; y: number }) => p,
  };
  const parent = { getAbsoluteTransform: () => identity };
  const node = {
    attrs,
    setAttrs: (a: Record<string, unknown>) => Object.assign(attrs, a),
    x: () => attrs["x"] as number,
    y: () => attrs["y"] as number,
    rotation: () => attrs["rotation"] as number,
    getAttr: (key: string) => attrs[key],
    scaleX: () => (attrs["scaleX"] as number) ?? 1,
    scaleY: () => (attrs["scaleY"] as number) ?? 1,
    width: () => w,
    height: () => h,
    getParent: () => parent,
    getLayer: () => ({}),
    getClientRect: () => ({
      x: attrs["x"] as number,
      y: attrs["y"] as number,
      width: w,
      height: h,
    }),
  };
  return node;
}

const base = (over: Partial<ObjectBase> = {}): ObjectBase => ({
  x: 0,
  y: 0,
  w: 40,
  h: 40,
  rotation: 0,
  opacity: 1,
  z: 0,
  visible: true,
  ...over,
});

const object = (id: string, over: Partial<PlanObject> = {}): PlanObject => ({
  id,
  type: "shape",
  shape: "circle",
  base: base(),
  ...over,
});

const plan: Plan = {
  id: "p",
  title: "t",
  raid: "",
  attacks: [],
  background: { assetId: "arena", width: 1000, height: 1000 },
  objects: [],
  slides: [{ id: "s0", states: {}, animations: [] }],
  groups: {},
  schemaVersion: SCHEMA_VERSION,
};

/** One tick of GSAP's ticker, which is what the runtime rides. */
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

let nodes: Record<string, unknown>;
let ref: { current: Stage | null };

const stage = () =>
  ({
    findOne: (selector: string) => nodes[selector.replace("#", "")],
    batchDraw: () => {},
  }) as unknown as Stage;

beforeEach(() => {
  useEditorStore.getState().reset();
  useEditorStore.getState().loadPlan(plan);
  clearHistory();

  nodes = {};
  ref = { current: stage() };
});

describe("an object that follows another", () => {
  /** An indicator drawn pointing right, turning about its own middle. */
  const indicator = object("indicator", {
    base: base({ x: 100, y: 100, w: 80, h: 20, ox: 0, oy: 0.5 }),
    follow: { aim: "orb" },
  });
  const orb = object("orb", { base: base({ x: 400, y: 100 }) });

  beforeEach(() => {
    useEditorStore.getState().reset();
    useEditorStore.getState().loadPlan({ ...plan, objects: [indicator, orb] });
    clearHistory();

    // The node's size must match the document's: the follow runtime reads its
    // size off the node now that a slide, not `base`, says how big a thing is.
    const indicatorNode = fakeNode({ x: 100, y: 100, w: 80, h: 20 });
    const orbNode = fakeNode({ x: 400, y: 100 });
    nodes = { indicator: indicatorNode, orb: orbNode };
    ref = { current: stage() };
  });

  it("turns to keep facing its target", async () => {
    renderHook(() => useFollowing(ref));
    await tick();

    const node = nodes["indicator"] as ReturnType<typeof fakeNode>;
    // The orb's centre is (420,120); the indicator's origin is its left edge's
    // middle, at (100,110). That is very slightly downhill, so barely a turn.
    expect(node.attrs["rotation"]).toBeCloseTo(1.79, 1);

    // Swing the orb to straight below and it follows round.
    (nodes["orb"] as ReturnType<typeof fakeNode>).setAttrs({ x: 80, y: 500 });
    await tick();
    expect(node.attrs["rotation"]).toBeCloseTo(90);
  });

  it("keeps its origin still while it turns", async () => {
    renderHook(() => useFollowing(ref));
    (nodes["orb"] as ReturnType<typeof fakeNode>).setAttrs({ x: 80, y: 500 });
    await tick();

    const node = nodes["indicator"] as ReturnType<typeof fakeNode>;
    // Origin = (x,y) + R(90)·(0, 10) = (x − 10, y). It began at (100,110) and
    // must still be there.
    expect((node.attrs["x"] as number) - 10).toBeCloseTo(100);
    expect(node.attrs["y"]).toBeCloseTo(110);
  });

  it("does nothing for objects that follow nothing", async () => {
    useEditorStore
      .getState()
      .loadPlan({ ...plan, objects: [object("a"), object("b")] });
    nodes = { a: fakeNode({ x: 1, y: 2 }), b: fakeNode({ x: 3, y: 4 }) };
    renderHook(() => useFollowing(ref));
    await tick();

    expect((nodes["a"] as ReturnType<typeof fakeNode>).attrs["x"]).toBe(1);
  });

  /**
   * The chrome that reads these nodes back — the origin handle's correction,
   * the selection frame — registers from components nested inside `CanvasStage`,
   * and React flushes effects child-first. So a reader is always on the ticker
   * *before* this hook is, and in plain add order it would run a frame behind
   * the placement: reading a node React had just reset to its document
   * placement, and drawing the handle at the object's un-followed position for
   * exactly one frame before the next tick put it right.
   */
  it("places the node before anything registered earlier reads it", async () => {
    const seen: number[] = [];
    const reader = () => {
      const node = nodes["indicator"] as ReturnType<typeof fakeNode>;
      seen.push(node.attrs["rotation"] as number);
    };
    // On the ticker first, exactly as the origin handle is.
    gsap.ticker.add(reader);
    try {
      renderHook(() => useFollowing(ref));
      await tick();

      // The *first* frame is the whole point: the reader must never catch the
      // node at the rotation the document still says it has.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen[0]).toBeCloseTo(1.79, 1);
      expect(seen.every((r) => Math.abs(r - 1.79) < 0.1)).toBe(true);
    } finally {
      gsap.ticker.remove(reader);
    }
  });
});
