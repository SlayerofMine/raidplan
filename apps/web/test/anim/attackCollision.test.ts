import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Stage } from "konva/lib/Stage";
import {
  expandPlan,
  SCHEMA_VERSION,
  type AttackDef,
  type Plan,
} from "@raidplan/shared";
import { usePlayback } from "../../src/anim/usePlayback";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

/**
 * An attack that reacts to *the plan's* objects, driven through the real
 * playback engine (plan §7 / §18.4).
 *
 * The engine only ever talks to Konva through `findOne`/`setAttrs`/
 * `getClientRect`, so a handful of fake nodes stand in for a stage: they record
 * what playback writes and report boxes from it. That makes "did the collision
 * fire" an assertion instead of a screenshot.
 */
const SIZE = 100;

interface FakeNode {
  attrs: {
    x: number;
    y: number;
    rotation: number;
    opacity: number;
    visible: boolean;
  };
  /** Every visibility change written, in order — how a re-arm is observed. */
  visibilityWrites: boolean[];
  setAttrs: (a: Record<string, unknown>) => void;
  getAttr: (key: string) => unknown;
  scaleX: () => number;
  scaleY: () => number;
  visible: () => boolean;
  x: () => number;
  y: () => number;
  rotation: () => number;
  opacity: () => number;
  getLayer: () => object;
  getClientRect: () => { x: number; y: number; width: number; height: number };
}

function fakeNode(): FakeNode {
  const layer = {};
  const node: FakeNode = {
    attrs: { x: 0, y: 0, rotation: 0, opacity: 1, visible: true },
    visibilityWrites: [],
    setAttrs: (a) => {
      const visible = a["visible"];
      if (typeof visible === "boolean" && visible !== node.attrs.visible) {
        node.visibilityWrites.push(visible);
      }
      Object.assign(node.attrs, a);
    },
    getAttr: (key) => (node.attrs as Record<string, unknown>)[key],
    scaleX: () => 1,
    scaleY: () => 1,
    visible: () => node.attrs.visible,
    x: () => node.attrs.x,
    y: () => node.attrs.y,
    rotation: () => node.attrs.rotation,
    opacity: () => node.attrs.opacity,
    getLayer: () => layer,
    getClientRect: () => ({
      x: node.attrs.x,
      y: node.attrs.y,
      width: SIZE,
      height: SIZE,
    }),
  };
  return node;
}

/**
 * A stage that has a node for every object in the loaded plan.
 *
 * The ref is created once and kept: `usePlayback` rebuilds the step whenever it
 * changes, so a fresh ref object per render would re-snap every object to the
 * step's start on every render — including the one that follows the collision.
 */
function fakeStage(ids: string[]) {
  const nodes = new Map(ids.map((id) => [id, fakeNode()]));
  const stage = {
    findOne: (selector: string) => nodes.get(selector.replace("#", "")),
    batchDraw: () => {},
  };
  return { ref: { current: stage as unknown as Stage }, nodes };
}

/** A cone that slides right, and vanishes the moment it touches a victim. */
const def: AttackDef = {
  id: "atk",
  encounterId: "enc",
  name: "Vanishing Cone",
  version: 1,
  defaultSize: { w: 400, h: 100 },
  objects: [
    {
      id: "cone",
      type: "shape",
      shape: "cone",
      base: {
        x: -1,
        y: -1,
        w: 0.5,
        h: 2,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    },
  ],
  overrides: { cone: { x: 0.5, y: -1 } },
  animations: [
    {
      id: "slide",
      objectId: "cone",
      kind: "motion",
      effect: "move",
      trigger: "onEnter",
      delayMs: 0,
      durationMs: 200,
      easing: "none",
    },
    {
      id: "caught",
      objectId: "cone",
      kind: "exit",
      effect: "disappear",
      trigger: "onCollision",
      delayMs: 0,
      durationMs: 0,
      easing: "none",
    },
  ],
  params: [{ key: "victims", label: "Caught by", type: "objectRefs" }],
  bindings: {
    collideWith: { caught: "victims" },
    durationMs: {},
    delayMs: {},
    tint: {},
  },
};

/** The plan: one token, and the attack told to react to it. */
const plan: Plan = {
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1000, height: 1000 },
  objects: [
    {
      id: "tank",
      type: "token",
      base: {
        x: 300,
        y: 0,
        w: SIZE,
        h: SIZE,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    },
  ],
  attacks: [
    {
      id: "i1",
      attackId: "atk",
      stepId: "s0",
      x: 0,
      y: 0,
      w: 400,
      h: 100,
      rotation: 0,
      startMs: 0,
      args: { victims: ["tank"] },
    },
  ],
  steps: [{ id: "s0", overrides: {}, animations: [] }],
  schemaVersion: SCHEMA_VERSION,
};

const CONE = "i1::cone";

/** Let real time pass — GSAP's ticker drives both the tween and the watcher. */
const settle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeEach(() => {
  useEditorStore.getState().reset();
  useEditorStore.getState().loadPlan(expandPlan(plan, { atk: def }));
  clearHistory();
});

describe("an attack colliding with a plan object", () => {
  it("fires the collision and takes the attack off screen", async () => {
    const { ref, nodes } = fakeStage(useEditorStore.getState().objectIds);
    const { result } = renderHook(() => usePlayback(ref));

    act(() => result.current.play());
    // Long enough for the slide to carry the cone into the token.
    await settle(400);

    // The disappear has to *stick*: the slide is still running when contact
    // happens, and it used to re-assert `visible: true` a frame later.
    expect(nodes.get(CONE)!.visible()).toBe(false);
  });

  it("still watches after the step's own animations have finished", async () => {
    // The victim is nowhere near the cone's path, so the slide ends with no
    // contact...
    const late = structuredClone(plan);
    late.objects[0]!.base.x = 900;
    useEditorStore.getState().loadPlan(expandPlan(late, { atk: def }));

    const { ref, nodes } = fakeStage(useEditorStore.getState().objectIds);
    const { result } = renderHook(() => usePlayback(ref));

    act(() => result.current.play());
    await settle(400);
    expect(nodes.get(CONE)!.visible()).toBe(true);

    // ...and then something moves the victim onto it — a click-triggered
    // animation, a later tween. The watch has to outlive the step's timeline,
    // or a collision is only possible during the first few hundred ms.
    act(() => nodes.get("tank")!.setAttrs({ x: 300 }));
    await settle(200);

    expect(nodes.get(CONE)!.visible()).toBe(false);
  });

  it("re-arms when the step is played again", async () => {
    const { ref, nodes } = fakeStage(useEditorStore.getState().objectIds);
    const { result } = renderHook(() => usePlayback(ref));
    const cone = nodes.get(CONE)!;

    act(() => result.current.play());
    await settle(400);
    expect(cone.visible()).toBe(false);

    // NB: no rewind press in between — just play again.
    // Watching the step again has to look like watching it the first time:
    // pressing play on a finished step starts it over rather than resuming a
    // spent one, so the cone comes back and is caught again.
    act(() => result.current.play());
    await settle(400);

    expect(cone.visible()).toBe(false);
    // Hidden by the step's opening snap, shown by the attack's entrance, taken
    // away by the collision — then all of it again. A spent playthrough would
    // stop after the first `false`.
    expect(cone.visibilityWrites).toEqual([false, true, false, true, false]);
  });

  it("stays on screen when the plan nominated nobody", async () => {
    const bare = structuredClone(plan);
    bare.attacks[0]!.args = {};
    useEditorStore.getState().loadPlan(expandPlan(bare, { atk: def }));

    const { ref, nodes } = fakeStage(useEditorStore.getState().objectIds);
    const { result } = renderHook(() => usePlayback(ref));

    act(() => result.current.play());
    await settle(400);

    // Nothing to hit, so the attack simply finishes its slide.
    expect(nodes.get(CONE)!.visible()).toBe(true);
  });
});
