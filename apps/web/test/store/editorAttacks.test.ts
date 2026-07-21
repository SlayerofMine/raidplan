import { beforeEach, describe, expect, it } from "vitest";
import { attackIdsInPlan } from "@raidplan/shared";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

/**
 * Placed attacks (plan §17, stage 5). A plan stores only instances; the store's
 * job is to put them on a step, retune them, and round-trip them through the
 * serialized document.
 */
const state = () => useEditorStore.getState();

beforeEach(() => {
  state().reset();
  clearHistory();
});

describe("addAttack", () => {
  it("drops an instance onto a step with sane defaults", () => {
    state().addStep();
    const id = state().addAttack(0, "atk1", { x: 400, y: 300 });

    const attacks = state().steps[0]!.attacks!;
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({
      id,
      attackId: "atk1",
      x: 400,
      y: 300,
      rotation: 0,
      scale: 1,
      startMs: 0,
    });
  });

  it("refuses a step that doesn't exist", () => {
    expect(state().addAttack(3, "atk1", { x: 0, y: 0 })).toBeUndefined();
  });

  it("keeps several instances of one attack apart", () => {
    state().addStep();
    const a = state().addAttack(0, "atk1", { x: 1, y: 1 });
    const b = state().addAttack(0, "atk1", { x: 2, y: 2 });
    expect(a).not.toBe(b);
    expect(state().steps[0]!.attacks).toHaveLength(2);
  });
});

describe("updateAttack", () => {
  it("retunes position, rotation, scale and timing", () => {
    state().addStep();
    const id = state().addAttack(0, "atk1", { x: 0, y: 0 })!;
    state().updateAttack(0, id, {
      x: 50,
      rotation: 90,
      scale: 2,
      startMs: 250,
    });

    expect(state().steps[0]!.attacks![0]).toMatchObject({
      x: 50,
      rotation: 90,
      scale: 2,
      startMs: 250,
    });
  });

  it("ignores an unknown instance rather than throwing", () => {
    state().addStep();
    expect(() => state().updateAttack(0, "ghost", { x: 1 })).not.toThrow();
  });
});

describe("removeAttack", () => {
  it("removes just that instance", () => {
    state().addStep();
    const a = state().addAttack(0, "atk1", { x: 1, y: 1 })!;
    state().addAttack(0, "atk2", { x: 2, y: 2 });

    state().removeAttack(0, a);

    const attacks = state().steps[0]!.attacks!;
    expect(attacks).toHaveLength(1);
    expect(attacks[0]!.attackId).toBe("atk2");
  });
});

describe("round-trip", () => {
  it("carries placed attacks and the encounter through the document", () => {
    state().loadPlan({
      id: "p",
      title: "t",
      raid: "Amirdrassil",
      encounterId: "enc1",
      background: { assetId: "arena", width: 1600, height: 900 },
      objects: [],
      steps: [{ id: "s0", overrides: {}, animations: [] }],
      schemaVersion: 1,
    });
    state().addAttack(0, "atk1", { x: 10, y: 20 });

    const plan = state().getPlan();
    expect(plan.encounterId).toBe("enc1");
    expect(attackIdsInPlan(plan)).toEqual(["atk1"]);
    expect(plan.steps[0]!.attacks![0]).toMatchObject({ x: 10, y: 20 });
  });
});
