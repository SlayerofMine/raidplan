import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Stage } from "konva/lib/Stage";
import {
  attackGroupId,
  SCHEMA_VERSION,
  type AttackDef,
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
function fakeNode(box: { x: number; y: number; rotation?: number }) {
  const attrs: Record<string, unknown> = { rotation: 0, ...box };
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
    getParent: () => parent,
    getLayer: () => ({}),
    getClientRect: () => ({
      x: attrs["x"] as number,
      y: attrs["y"] as number,
      width: 40,
      height: 40,
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

/**
 * A frontal cast from the middle of its left edge, pointing right: it hangs off
 * whatever fills "from" and turns towards whatever fills "at".
 */
const def: AttackDef = {
  id: "atk",
  encounterId: "enc",
  name: "Frontal",
  version: 1,
  defaultSize: { w: 200, h: 200 },
  objects: [
    { id: "cone", type: "shape", shape: "cone", base: base({ w: 2, h: 2 }) },
    { id: "from", type: "placeholder", base: base() },
    { id: "at", type: "placeholder", base: base() },
  ],
  overrides: {},
  animations: [],
  ox: 0,
  oy: 0.5,
  dir: 0,
  follow: { pin: "from", aim: "at" },
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
};

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
  background: { assetId: "arena", width: 1000, height: 1000 },
  objects: [],
  attacks: [
    {
      id: "i1",
      attackId: "atk",
      stepId: "s0",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      rotation: 0,
      startMs: 0,
      slots: { from: "boss", at: "tank" },
      args: {},
    },
  ],
  steps: [{ id: "s0", overrides: {}, animations: [] }],
  schemaVersion: SCHEMA_VERSION,
};

/** One tick of GSAP's ticker, which is what the runtime rides. */
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

let boss: ReturnType<typeof fakeNode>;
let tank: ReturnType<typeof fakeNode>;
let group: ReturnType<typeof fakeNode>;
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
  useEditorStore.getState().setAttackDefs({ atk: def });
  clearHistory();

  boss = fakeNode({ x: 500, y: 500 });
  tank = fakeNode({ x: 900, y: 500 });
  group = fakeNode({ x: 0, y: 0 });
  nodes = { boss, tank, [attackGroupId("i1")]: group };
  ref = { current: stage() };
});

describe("a whole attack that follows the board", () => {
  it("carries the attack's parts to the object it hangs off", async () => {
    renderHook(() => useFollowing(ref));
    await tick();

    // The group is moved, not the parts: whatever the animations are doing to
    // them inside carries on untouched. The boss's centre is (520,520), and the
    // attack's origin is the middle of its left edge, so that is what lands
    // there — the group turns about it and is placed by it.
    expect(group.attrs["offsetX"]).toBeCloseTo(0);
    expect(group.attrs["offsetY"]).toBeCloseTo(100);
    expect(group.attrs["x"]).toBeCloseTo(520);
    expect(group.attrs["y"]).toBeCloseTo(520);
  });

  it("re-aims when the target moves — every frame, not per step", async () => {
    renderHook(() => useFollowing(ref));
    await tick();
    expect(group.attrs["rotation"]).toBeCloseTo(0);

    // Nothing re-rendered and no step changed: the token simply moved, as it
    // does mid-drag and mid-tween.
    tank.setAttrs({ x: 500, y: 900 });
    await tick();

    expect(group.attrs["rotation"]).toBeCloseTo(90);
    // And it is still cast from the boss, not swung off him.
    expect(group.attrs["x"]).toBeCloseTo(520);
    expect(group.attrs["y"]).toBeCloseTo(520);
  });

  it("leaves the attack alone when what it follows isn't on the board", async () => {
    useEditorStore.getState().loadPlan({
      ...plan,
      attacks: [{ ...plan.attacks[0]!, slots: {} }],
    });
    renderHook(() => useFollowing(ref));
    await tick();

    // Better where the plan put it than snapped to the origin of nothing.
    expect(group.attrs["rotation"]).toBe(0);
    expect(group.attrs["x"]).toBe(0);
  });

  it("does nothing at all for an attack that follows nothing", async () => {
    useEditorStore
      .getState()
      .setAttackDefs({ atk: { ...def, follow: undefined } });
    renderHook(() => useFollowing(ref));
    await tick();

    // No ticker, no writes — the common case costs nothing.
    expect(group.attrs["x"]).toBe(0);
  });

  it("takes the instance's own follow over the definition's", async () => {
    useEditorStore.getState().loadPlan({
      ...plan,
      attacks: [{ ...plan.attacks[0]!, follow: { pin: "tank" } }],
    });
    renderHook(() => useFollowing(ref));
    await tick();

    // Pinned to the tank at (920,520), and not turned — the planner's follow
    // said nothing about aiming.
    expect(group.attrs["x"]).toBeCloseTo(920);
    expect(group.attrs["rotation"]).toBeCloseTo(0);
  });
});

describe("an ordinary object that follows another", () => {
  /** An indicator drawn pointing right, turning about its own middle. */
  const indicator = object("indicator", {
    base: base({ x: 100, y: 100, w: 80, h: 20, ox: 0, oy: 0.5 }),
    follow: { aim: "orb" },
  });
  const orb = object("orb", { base: base({ x: 400, y: 100 }) });

  beforeEach(() => {
    useEditorStore.getState().reset();
    useEditorStore
      .getState()
      .loadPlan({ ...plan, attacks: [], objects: [indicator, orb] });
    clearHistory();

    const indicatorNode = fakeNode({ x: 100, y: 100 });
    const orbNode = fakeNode({ x: 400, y: 100 });
    nodes = { indicator: indicatorNode, orb: orbNode };
    ref = { current: stage() };
  });

  it("turns to keep facing its target, without being an attack at all", async () => {
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
      .loadPlan({ ...plan, attacks: [], objects: [object("a"), object("b")] });
    nodes = { a: fakeNode({ x: 1, y: 2 }), b: fakeNode({ x: 3, y: 4 }) };
    renderHook(() => useFollowing(ref));
    await tick();

    expect((nodes["a"] as ReturnType<typeof fakeNode>).attrs["x"]).toBe(1);
  });
});
