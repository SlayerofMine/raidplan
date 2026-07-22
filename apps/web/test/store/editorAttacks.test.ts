import { beforeEach, describe, expect, it } from "vitest";
import { attackIdsInPlan, SCHEMA_VERSION } from "@raidplan/shared";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";
import { pickPlanDoc, sameDocument } from "../../src/store/planSerialization";

/**
 * Placed attacks (plan §17, remodelled in §18.3). A plan stores only instances;
 * the store's job is to put them on the board, say which step fires them,
 * retune them, and round-trip them through the serialized document.
 */
const state = () => useEditorStore.getState();

beforeEach(() => {
  state().reset();
  clearHistory();
});

describe("addAttack", () => {
  it("drops an instance on the board with sane defaults", () => {
    const stepId = state().addStep();
    const id = state().addAttack("atk1", { x: 400, y: 300 });

    expect(state().attacks).toHaveLength(1);
    // Centred on the drop point, at the def's default size (400 by default).
    expect(state().attacks[0]).toMatchObject({
      id,
      attackId: "atk1",
      stepId,
      x: 200,
      y: 100,
      w: 400,
      h: 400,
      rotation: 0,
      startMs: 0,
    });
  });

  it("selects what it just placed, so it can be dragged straight away", () => {
    state().addStep();
    const id = state().addAttack("atk1", { x: 0, y: 0 });
    expect(state().selectedAttackIds).toEqual([id]);
  });

  it("fires on the step being edited", () => {
    state().addStep();
    const second = state().addStep();
    state().selectStep(1);
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    expect(state().attacks.find((a) => a.id === id)!.stepId).toBe(second);
  });

  it("makes a step when the plan has none — an attack has to happen somewhen", () => {
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    expect(state().steps).toHaveLength(1);
    expect(state().attacks.find((a) => a.id === id)!.stepId).toBe(
      state().steps[0]!.id,
    );
  });

  it("keeps several instances of one attack apart", () => {
    state().addStep();
    const a = state().addAttack("atk1", { x: 1, y: 1 });
    const b = state().addAttack("atk1", { x: 2, y: 2 });
    expect(a).not.toBe(b);
    expect(state().attacks).toHaveLength(2);
  });
});

describe("updateAttack", () => {
  it("retunes position, rotation, scale and timing", () => {
    state().addStep();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    state().updateAttack(id, { x: 50, w: 300, rotation: 90, startMs: 250 });

    expect(state().attacks[0]).toMatchObject({
      x: 50,
      w: 300,
      rotation: 90,
      startMs: 250,
    });
  });

  it("moves an attack to another step", () => {
    state().addStep();
    const later = state().addStep();
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    state().updateAttack(id, { stepId: later });
    expect(state().attacks[0]!.stepId).toBe(later);
  });

  it("ignores an unknown instance rather than throwing", () => {
    expect(() => state().updateAttack("ghost", { x: 1 })).not.toThrow();
  });
});

describe("removeAttack", () => {
  it("removes just that instance", () => {
    state().addStep();
    const a = state().addAttack("atk1", { x: 1, y: 1 })!;
    state().addAttack("atk2", { x: 2, y: 2 });

    state().removeAttack(a);

    expect(state().attacks).toHaveLength(1);
    expect(state().attacks[0]!.attackId).toBe("atk2");
  });

  it("takes the attacks fired by a deleted step with it", () => {
    const first = state().addStep();
    state().addStep();
    state().selectStep(0);
    state().addAttack("atk1", { x: 0, y: 0 });
    state().selectStep(1);
    const survivor = state().addAttack("atk2", { x: 0, y: 0 });

    state().deleteStep(0);

    // Without its step there is no moment for it to happen. (Undo brings the
    // step and its attacks back together.)
    expect(state().attacks.map((a) => a.id)).toEqual([survivor]);
    expect(state().steps.map((s) => s.id)).not.toContain(first);
  });
});

describe("an attack is document content in its own right", () => {
  it("counts as something on the board, so a lone attack isn't an empty plan", () => {
    state().addAttack("atk1", { x: 0, y: 0 });
    // What the toolbar reads: objects plus attacks.
    expect(state().objectIds.length + state().attacks.length).toBe(1);
  });

  it("marks the document as changed, so autosave fires for it", () => {
    // The step already exists, so placing the attack is the *only* edit —
    // exactly the case that never saved.
    state().addStep();
    const before = pickPlanDoc(state());
    state().addAttack("atk1", { x: 0, y: 0 });
    // Nothing else persists an attack: a plan whose only content is one has no
    // other edit to piggyback on.
    expect(sameDocument(before, pickPlanDoc(state()))).toBe(false);
  });

  it("comes along when its step is duplicated", () => {
    state().addStep();
    const original = state().addAttack("atk1", { x: 10, y: 20 })!;
    state().duplicateStep(0);

    expect(state().attacks).toHaveLength(2);
    const copy = state().attacks.find((a) => a.id !== original)!;
    // Same placement, its own identity, fired by the copied step.
    expect(copy).toMatchObject({ attackId: "atk1", x: 10 - 200, y: 20 - 200 });
    expect(copy.stepId).toBe(state().steps[1]!.id);
  });

  it("drops a deleted object from the arguments that named it", () => {
    const tank = state().addPrimitive("shape", "circle");
    const healer = state().addPrimitive("shape", "circle");
    const id = state().addAttack("atk1", { x: 0, y: 0 })!;
    state().updateAttack(id, { args: { victims: [tank, healer] } });

    state().deleteObjects([tank]);

    // A dangling reference would resurrect on undo and mean nothing at play.
    expect(state().attacks[0]!.args["victims"]).toEqual([healer]);
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
      attacks: [],
      steps: [{ id: "s0", overrides: {}, animations: [] }],
      schemaVersion: SCHEMA_VERSION,
    });
    state().addAttack("atk1", { x: 10, y: 20 });

    const plan = state().getPlan();
    expect(plan.encounterId).toBe("enc1");
    expect(attackIdsInPlan(plan)).toEqual(["atk1"]);
    expect(plan.attacks[0]).toMatchObject({ w: 400, h: 400, stepId: "s0" });
  });
});
