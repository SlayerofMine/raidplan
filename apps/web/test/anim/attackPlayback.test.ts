import { describe, expect, it } from "vitest";
import {
  expandPlan,
  resolveObjectState,
  SCHEMA_VERSION,
  type AttackDef,
  type ObjectState,
  type Plan,
  type ResolvedStates,
} from "@raidplan/shared";
import { compileStep } from "../../src/anim/compileStep";

/**
 * A placed attack has to be *on screen* while its step plays.
 *
 * Its parts are materialised hidden (that's what keeps them off the steps around
 * it) and nothing tweens `visible`, so this pins the end of that chain: expand a
 * plan, compile the step exactly as the player does, and watch the attack come
 * into view. The unit tests in shared cover the expansion; this covers the
 * handover to GSAP.
 */
const def: AttackDef = {
  id: "atk",
  encounterId: "enc",
  name: "Sweeping Flame",
  version: 1,
  defaultSize: { w: 200, h: 200 },
  objects: [
    {
      id: "cone",
      type: "shape",
      shape: "circle",
      // Unit space: a narrow band that sweeps from the left edge to the right,
      // so the attack's extent — and its rectangle — is the whole sweep.
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
  // It sweeps to the right edge over the step.
  overrides: { cone: { x: 0.5, y: -1 } },
  animations: [
    {
      id: "sweep",
      objectId: "cone",
      kind: "motion",
      effect: "move",
      trigger: "onEnter",
      delayMs: 0,
      durationMs: 500,
      easing: "none",
    },
  ],
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
      slots: {},
      args: {},
    },
  ],
  steps: [
    { id: "s0", overrides: {}, animations: [] },
    { id: "s1", overrides: {}, animations: [] },
  ],
  schemaVersion: SCHEMA_VERSION,
};

/** Every object's state on a step, the way the playback hook resolves them. */
function statesOn(doc: Plan, index: number): ResolvedStates {
  const states: ResolvedStates = {};
  for (const object of doc.objects) {
    states[object.id] = resolveObjectState(object, doc.steps, index);
  }
  return states;
}

function playStep(doc: Plan, index: number) {
  const applied: Record<string, Partial<ObjectState>> = {};
  const { timeline, initial } = compileStep({
    step: doc.steps[index]!,
    start: statesOn(doc, index - 1),
    end: statesOn(doc, index),
    // A patch per push, merged the way a Konva node accumulates them.
    apply: (objectId, props) => {
      applied[objectId] = { ...applied[objectId], ...props };
    },
  });
  return { timeline, initial, applied };
}

describe("a placed attack during playback", () => {
  const expanded = expandPlan(plan, { atk: def });

  it("starts the step hidden and is on screen by the end of it", () => {
    const { timeline, initial, applied } = playStep(expanded, 0);

    expect(initial["i1::cone"]!.visible).toBe(false);
    timeline.progress(1);
    expect(applied["i1::cone"]!.visible).toBe(true);
  });

  it("sweeps to the def's end state, placed into the instance rectangle", () => {
    const { timeline, applied } = playStep(expanded, 0);

    timeline.progress(1);
    // The band is a quarter of the width, so its left edge settles at 150 —
    // flush with the right edge of a 0..200 instance.
    expect(applied["i1::cone"]!.x).toBeCloseTo(150);
  });

  it("is gone once the step after it is entered", () => {
    // The next step's start state is this step's settled state, so the attack is
    // still up; its own step's end took it away.
    expect(statesOn(expanded, 1)["i1::cone"]!.visible).toBe(false);
  });
});
