import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Stage } from "konva/lib/Stage";
import {
  attackGroupId,
  SCHEMA_VERSION,
  type AttackDef,
  type Plan,
} from "@raidplan/shared";
import { useAttackAnchors } from "../../src/anim/useAttackAnchors";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

/**
 * An attack that follows the board (plan §18.15), driven on the real ticker.
 *
 * The runtime only ever talks to Konva through `findOne` and `setAttrs`, so a
 * couple of fake nodes stand in for the stage: the boss and the target report
 * boxes, and the attack's group records what was written to it. Moving a token
 * and watching the group turn is then an assertion rather than a screenshot.
 */
function fakeNode(box: { x: number; y: number }) {
  const attrs: Record<string, unknown> = { ...box };
  const layer = {};
  return {
    attrs,
    setAttrs: (a: Record<string, unknown>) => Object.assign(attrs, a),
    getLayer: () => layer,
    getClientRect: () => ({
      x: attrs["x"] as number,
      y: attrs["y"] as number,
      width: 40,
      height: 40,
    }),
  };
}

/** A frontal that hangs off the boss and looks at whoever it is aimed at. */
const def: AttackDef = {
  id: "atk",
  encounterId: "enc",
  name: "Frontal",
  version: 1,
  defaultSize: { w: 200, h: 200 },
  objects: [
    {
      id: "cone",
      type: "shape",
      shape: "cone",
      base: {
        x: -1,
        y: -1,
        w: 2,
        h: 2,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    },
    {
      id: "from",
      type: "placeholder",
      base: {
        x: -1.1,
        y: -0.1,
        w: 0.2,
        h: 0.2,
        rotation: 0,
        opacity: 1,
        z: 1,
        visible: true,
      },
    },
    {
      id: "at",
      type: "placeholder",
      base: {
        x: 0.9,
        y: -0.1,
        w: 0.2,
        h: 0.2,
        rotation: 0,
        opacity: 1,
        z: 2,
        visible: true,
      },
    },
  ],
  overrides: {},
  animations: [],
  anchor: { originId: "from", facingId: "at" },
  lookAts: [],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
};

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
let ref: { current: Stage | null };

beforeEach(() => {
  useEditorStore.getState().reset();
  useEditorStore.getState().loadPlan(plan);
  useEditorStore.getState().setAttackDefs({ atk: def });
  clearHistory();

  boss = fakeNode({ x: 500, y: 500 });
  tank = fakeNode({ x: 900, y: 500 });
  group = fakeNode({ x: 0, y: 0 });
  const nodes: Record<string, unknown> = {
    boss,
    tank,
    [attackGroupId("i1")]: group,
  };
  ref = {
    current: {
      findOne: (selector: string) => nodes[selector.replace("#", "")],
      batchDraw: () => {},
    } as unknown as Stage,
  };
});

describe("an attack anchored to the board", () => {
  it("carries the attack's parts to its origin", async () => {
    renderHook(() => useAttackAnchors(ref));
    await tick();

    // The group is moved, not the parts: whatever the animations are doing to
    // them inside carries on untouched. The boss's centre is (520,520) and the
    // origin placeholder sits on the rectangle's left edge, so the rectangle's
    // centre lands 100 further along.
    expect(group.attrs["offsetX"]).toBeCloseTo(100);
    expect(group.attrs["x"]).toBeCloseTo(620);
    expect(group.attrs["y"]).toBeCloseTo(520);
  });

  it("re-aims when the target moves — every frame, not per step", async () => {
    renderHook(() => useAttackAnchors(ref));
    await tick();
    expect(group.attrs["rotation"]).toBeCloseTo(0);

    // Nothing re-rendered and no step changed: the token simply moved, as it
    // does mid-drag and mid-tween.
    tank.setAttrs({ x: 500, y: 900 });
    await tick();

    expect(group.attrs["rotation"]).toBeCloseTo(90);
  });

  it("leaves the attack alone when its anchor isn't on the board", async () => {
    useEditorStore.getState().loadPlan({
      ...plan,
      attacks: [{ ...plan.attacks[0]!, slots: {} }],
    });
    renderHook(() => useAttackAnchors(ref));
    await tick();

    // Better where the plan put it than snapped to the origin of nothing.
    expect(group.attrs["rotation"]).toBeUndefined();
  });

  it("does nothing at all for an attack that isn't anchored", async () => {
    useEditorStore
      .getState()
      .setAttackDefs({ atk: { ...def, anchor: undefined } });
    renderHook(() => useAttackAnchors(ref));
    await tick();

    // No ticker, no writes — the common case costs nothing.
    expect(group.attrs["x"]).toBe(0);
  });
});
