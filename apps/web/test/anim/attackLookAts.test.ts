import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Stage } from "konva/lib/Stage";
import { SCHEMA_VERSION, type AttackDef, type Plan } from "@raidplan/shared";
import { useAttackLookAts } from "../../src/anim/useAttackLookAts";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

/**
 * A part kept facing another part (plan §18.16), driven on the real ticker.
 *
 * The runtime reads the target's live box and writes the aimer's rotation, so a
 * couple of fake nodes stand in for the stage: the target reports a box that the
 * test moves, and the aimer records the rotation written to it. Moving the
 * target and watching the aimer turn is then an assertion, not a screenshot.
 */
function fakeNode(box: { x: number; y: number }) {
  const attrs: Record<string, unknown> = { ...box, rotation: 0 };
  const layer = {};
  return {
    attrs,
    x: () => attrs["x"] as number,
    y: () => attrs["y"] as number,
    rotation: (value?: number) => {
      if (value !== undefined) attrs["rotation"] = value;
      return attrs["rotation"] as number;
    },
    getLayer: () => layer,
    getClientRect: () => ({
      x: attrs["x"] as number,
      y: attrs["y"] as number,
      width: 20,
      height: 20,
    }),
  };
}

/**
 * An attack whose "arrow" is drawn at the origin pointing right at the "orb",
 * which sits directly to its right and animates away.
 */
const def: AttackDef = {
  id: "atk",
  encounterId: "enc",
  name: "Tracker",
  version: 1,
  defaultSize: { w: 200, h: 200 },
  objects: [
    {
      id: "arrow",
      type: "arrow",
      base: {
        x: 0,
        y: 0,
        w: 0.5,
        h: 0.1,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    },
    {
      id: "orb",
      type: "shape",
      shape: "circle",
      base: {
        x: 0.5,
        y: 0,
        w: 0.2,
        h: 0.2,
        rotation: 0,
        opacity: 1,
        z: 1,
        visible: true,
      },
    },
  ],
  overrides: {},
  animations: [],
  anchor: undefined,
  lookAts: [{ objectId: "arrow", targetId: "orb" }],
  params: [],
  bindings: { collideWith: {}, durationMs: {}, delayMs: {}, tint: {} },
};

const plan: Plan = {
  id: "p",
  title: "t",
  raid: "",
  background: { assetId: "arena", width: 1000, height: 1000 },
  objects: [
    // The expanded parts, as the viewer's store holds them. The arrow's origin
    // is at (100,100); the orb's centre a little to its right.
    {
      id: "i1::arrow",
      type: "arrow",
      groupId: "i1",
      base: {
        x: 100,
        y: 100,
        w: 60,
        h: 8,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    },
    {
      id: "i1::orb",
      type: "shape",
      shape: "circle",
      groupId: "i1",
      base: {
        x: 190,
        y: 90,
        w: 20,
        h: 20,
        rotation: 0,
        opacity: 1,
        z: 1,
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
      w: 200,
      h: 200,
      rotation: 0,
      startMs: 0,
      slots: {},
      args: {},
    },
  ],
  steps: [{ id: "s0", overrides: {}, animations: [] }],
  schemaVersion: SCHEMA_VERSION,
};

const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

let arrow: ReturnType<typeof fakeNode>;
let orb: ReturnType<typeof fakeNode>;
let ref: { current: Stage | null };

beforeEach(() => {
  useEditorStore.getState().reset();
  useEditorStore.getState().loadPlan(plan);
  useEditorStore.getState().setAttackDefs({ atk: def });
  clearHistory();

  arrow = fakeNode({ x: 100, y: 100 });
  // The orb starts as a 20×20 box centred at (200,100), right of the arrow.
  orb = fakeNode({ x: 190, y: 90 });
  const nodes: Record<string, unknown> = { "i1::arrow": arrow, "i1::orb": orb };
  ref = {
    current: {
      findOne: (selector: string) => nodes[selector.replace("#", "")],
      batchDraw: () => {},
    } as unknown as Stage,
  };
});

describe("a part kept facing another part", () => {
  it("holds its drawn rotation while the target sits still", async () => {
    renderHook(() => useAttackLookAts(ref));
    await tick();
    expect(arrow.rotation()).toBeCloseTo(0);
  });

  it("turns to follow the target — every frame, from the attack's own motion", async () => {
    renderHook(() => useAttackLookAts(ref));
    await tick();
    expect(arrow.rotation()).toBeCloseTo(0);

    // The orb's animation carries it to directly below the arrow: no store
    // change, no step change — the node simply moved, as a tween moves it.
    orb.attrs["x"] = 90;
    orb.attrs["y"] = 190;
    await tick();

    expect(arrow.rotation()).toBeCloseTo(90);
  });

  it("does nothing for an attack with no look-at", async () => {
    useEditorStore.getState().setAttackDefs({ atk: { ...def, lookAts: [] } });
    renderHook(() => useAttackLookAts(ref));
    await tick();

    orb.attrs["x"] = 90;
    orb.attrs["y"] = 190;
    await tick();

    // No ticker, no writes — the common case costs nothing.
    expect(arrow.rotation()).toBe(0);
  });
});
