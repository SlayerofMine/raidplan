import { beforeEach, describe, expect, it } from "vitest";
import {
  layoutStepTimeline,
  slideAttacks,
  type AttackDef,
  type Plan,
  type PlanObject,
  type SlideState,
} from "@raidplan/shared";
import { clearHistory, useEditorStore } from "../../src/store/editorStore";

const state = () => useEditorStore.getState();

const BACKGROUND = { assetId: "arena", width: 1600, height: 900 };

const slideState = (over: Partial<SlideState> = {}): SlideState => ({
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  ...over,
});

function object(id: string, over: Partial<PlanObject> = {}): PlanObject {
  return {
    id,
    type: "token",
    base: {
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      opacity: 1,
      z: 0,
      visible: true,
    },
    ...over,
  };
}

/** A puddle that appears, and a bolt that flies at whoever fills the slot. */
function definition(over: Partial<AttackDef> = {}): AttackDef {
  return {
    id: "def_fireball",
    name: "Fireball",
    source: "plan",
    objects: [
      object("puddle", { type: "shape", shape: "voidzone" }),
      object("bolt"),
      object("target", { slotName: "the tank" }),
    ],
    slide: {
      id: "def-slide",
      states: {
        puddle: slideState({ x: 0, y: 0 }),
        bolt: slideState({ x: 200, y: 0 }),
        target: slideState({ x: 400, y: 0 }),
      },
      animations: [
        {
          id: "a_appear",
          objectId: "puddle",
          kind: "entrance",
          effect: "appear",
          trigger: "onEnter",
          delayMs: 0,
          durationMs: 0,
          easing: "none",
        },
        {
          id: "a_fly",
          objectId: "bolt",
          kind: "motion",
          effect: "move",
          trigger: "afterPrevious",
          delayMs: 0,
          durationMs: 500,
          easing: "power2.out",
          params: { toX: 400, toY: 0 },
        },
      ],
    },
    params: [
      {
        name: "colour",
        label: "Colour",
        kind: "color",
        value: "#ff0000",
        targets: [{ on: "object", targetId: "puddle", field: "tint" }],
      },
    ],
    ...over,
  };
}

/** A plan holding one definition and one token the planner can bind to it. */
function planWith(def: AttackDef): Plan {
  return {
    id: "local",
    title: "Test",
    raid: "",
    background: BACKGROUND,
    objects: [object("plan_tank", { base: { ...object("x").base, x: 800 } })],
    groups: {},
    attacks: [def],
    slides: [
      {
        id: "slide-1",
        states: { plan_tank: slideState({ x: 800, y: 500 }) },
        animations: [],
      },
    ],
    schemaVersion: 7,
  };
}

const instances = () =>
  slideAttacks(state().slides[state().currentSlideIndex]!);
const owned = (instanceId: string) =>
  state().objectIds.filter(
    (id) => state().objects[id]?.attackId === instanceId,
  );

beforeEach(() => {
  state().reset();
  state().setStageSize({ width: 0, height: 0 });
  state().setSnapEnabled(false);
  state().loadPlan(planWith(definition()));
  clearHistory();
});

describe("placing an attack", () => {
  it("refuses a definition with a slot while nothing is selected", () => {
    state().clearSelection();
    expect(state().placeAttack("def_fireball", { x: 0, y: 0 })).toBeUndefined();
    expect(Object.keys(instances())).toEqual([]);
  });

  it("refuses when more objects are selected than there are slots to fill", () => {
    state().addIcon("marker-skull");
    state().selectAll();
    expect(state().placeAttack("def_fireball", { x: 0, y: 0 })).toBeUndefined();
  });

  it("places it once the plan has said what fills the slot", () => {
    state().select(["plan_tank"]);
    const id = state().placeAttack("def_fireball", { x: 0, y: 0 });
    expect(id).toBeDefined();
    expect(Object.keys(instances())).toEqual([id]);
  });

  it("resolves on the spot into ordinary objects and animations", () => {
    state().select(["plan_tank"]);
    const id = state().placeAttack("def_fireball", { x: 0, y: 0 })!;
    // Two owned objects — the slot is a hole, not a thing.
    expect(owned(id)).toHaveLength(2);
    const slide = state().slides[0]!;
    expect(slide.animations).toHaveLength(2);
    for (const objectId of owned(id)) {
      expect(slide.states[objectId]).toBeDefined();
    }
  });

  it("lands on the object bound to its slot, not on the cursor", () => {
    state().select(["plan_tank"]);
    const id = state().placeAttack("def_fireball", { x: 0, y: 0 })!;
    const instance = instances()[id]!;
    // The slot was authored at (400,0) and the token sits at (800,500).
    expect(instance.transform.tx).toBeCloseTo(400, 6);
    expect(instance.transform.ty).toBeCloseTo(500, 6);
  });

  it("places a definition with no slots at the drop point, with nothing selected", () => {
    const def = definition({ id: "def_bare", name: "Meteor" });
    def.objects = def.objects.filter((o) => o.slotName === undefined);
    delete def.slide.states.target;
    state().loadPlan(planWith(def));
    state().clearSelection();
    expect(state().placeAttack("def_bare", { x: 700, y: 400 })).toBeDefined();
  });

  it("groups and selects what it placed, so it moves as one thing straight away", () => {
    state().select(["plan_tank"]);
    const id = state().placeAttack("def_fireball", { x: 0, y: 0 })!;
    const members = owned(id).map((oid) => state().objects[oid]!);
    expect(new Set(members.map((o) => o.groupId)).size).toBe(1);
    expect([...state().selectedIds].sort()).toEqual([...owned(id)].sort());
  });

  it("never marks the bound token as the attack's own", () => {
    state().select(["plan_tank"]);
    const id = state().placeAttack("def_fireball", { x: 0, y: 0 })!;
    expect(state().objects.plan_tank!.attackId).toBeUndefined();
    expect(owned(id)).not.toContain("plan_tank");
  });
});

describe("editing a placement", () => {
  let id: string;
  beforeEach(() => {
    state().select(["plan_tank"]);
    id = state().placeAttack("def_fireball", { x: 0, y: 0 })!;
  });

  it("re-derives the whole thing when a parameter changes", () => {
    state().setAttackParam(id, "colour", "#00ff00");
    const puddle = owned(id)
      .map((oid) => state().objects[oid]!)
      .find((o) => o.shape === "voidzone");
    expect(puddle?.base.tint).toBe("#00ff00");
  });

  it("keeps the same objects across a re-derivation, so nothing pointing at them breaks", () => {
    const before = owned(id);
    state().setAttackTransform(id, {
      tx: 100,
      ty: 100,
      rotationDeg: 45,
      sx: 2,
      sy: 2,
    });
    expect(owned(id)).toEqual(before);
  });

  it("moves the motion path with the attack, which a plain group transform would leave behind", () => {
    const destination = () =>
      state().slides[0]!.animations.find((a) => a.effect === "move")!.params!;
    const was = { ...destination() };
    state().setAttackTransform(id, {
      tx: 0,
      ty: 0,
      rotationDeg: 0,
      sx: 1,
      sy: 1,
    });
    expect(destination().toX).not.toBe(was.toX);
  });

  it("dragging the whole placement moves its recipe, so its motion paths come too", () => {
    const members = owned(id);
    const before = { ...state().slides[0]!.states[members[0]!]! };
    const wasDestination = state().slides[0]!.animations.find(
      (a) => a.effect === "move",
    )!.params!.toX!;
    const wasTx = instances()[id]!.transform.tx;

    state().moveObjects(
      members.map((oid) => {
        const s = state().slides[0]!.states[oid]!;
        return { id: oid, x: s.x + 40, y: s.y + 25 };
      }),
    );

    expect(instances()[id]!.transform.tx).toBeCloseTo(wasTx + 40, 6);
    expect(state().slides[0]!.states[members[0]!]!.x).toBeCloseTo(
      before.x + 40,
      6,
    );
    const now = state().slides[0]!.animations.find((a) => a.effect === "move")!
      .params!.toX!;
    expect(now).toBeCloseTo(wasDestination + 40, 6);
  });

  it("dragging one member out of a placement is not the placement moving", () => {
    const [first] = owned(id);
    const wasTx = instances()[id]!.transform.tx;
    const s = state().slides[0]!.states[first!]!;
    state().moveObjects([{ id: first!, x: s.x + 40, y: s.y }]);
    expect(instances()[id]!.transform.tx).toBe(wasTx);
  });

  it("slides the whole attack when its start moves", () => {
    state().setAttackTiming(id, { anchorDelayMs: 400 });
    const spans = layoutStepTimeline(state().slides[0]!.animations).spans;
    expect(spans[0]!.startMs).toBe(400);
  });

  it("DRIFT: retiming out and back restores the authored durations exactly", () => {
    const authored = state().slides[0]!.animations.map((a) => a.durationMs);
    for (const timeScale of [4, 0.3, 9.1, 1]) {
      state().setAttackTiming(id, { timeScale });
    }
    expect(state().slides[0]!.animations.map((a) => a.durationMs)).toEqual(
      authored,
    );
  });

  it("rebinding a slot re-aims the attack at the new object", () => {
    const other = state().addIcon("marker-skull");
    const before = instances()[id]!.slots.target;
    state().setAttackSlot(id, "target", other);
    expect(instances()[id]!.slots.target).toBe(other);
    expect(before).toBe("plan_tank");
    expect(
      state().slides[0]!.animations.some((a) => a.objectId === other),
    ).toBe(false); // this definition animates the slot only via collision
  });
});

describe("letting go of a placement", () => {
  let id: string;
  beforeEach(() => {
    state().select(["plan_tank"]);
    id = state().placeAttack("def_fireball", { x: 0, y: 0 })!;
  });

  it("detach leaves the objects exactly where they are, as an ordinary group", () => {
    const members = owned(id);
    const where = members.map((oid) => ({
      ...state().slides[0]!.states[oid]!,
    }));
    state().detachAttack(id);
    expect(instances()[id]).toBeUndefined();
    expect(state().objectIds).toEqual(expect.arrayContaining(members));
    members.forEach((oid, i) => {
      expect(state().slides[0]!.states[oid]).toEqual(where[i]);
      expect(state().objects[oid]!.groupId).toBeDefined();
    });
  });

  it("delete takes the attack and nothing else — the token it was bound to stays", () => {
    state().deleteAttack(id);
    expect(instances()[id]).toBeUndefined();
    expect(owned(id)).toEqual([]);
    expect(state().objects.plan_tank).toBeDefined();
    expect(state().slides[0]!.animations).toEqual([]);
  });

  it("deleting the last of its objects by hand dissolves the placement too", () => {
    state().deleteObjects(owned(id));
    expect(instances()[id]).toBeUndefined();
  });
});
