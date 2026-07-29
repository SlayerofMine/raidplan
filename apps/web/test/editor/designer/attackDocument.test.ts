import { describe, expect, it } from "vitest";
import {
  makeEmptyPlan,
  PlanSchema,
  type AttackDef,
  type AttackParam,
  type Plan,
} from "@raidplan/shared";
import {
  attackToPlan,
  DESIGNER_PLAN_ID,
  planToAttack,
  upsertAttack,
} from "../../../src/editor/designer/attackDocument";

const BACKGROUND = { assetId: "arena", width: 1600, height: 900 };

const box = {
  x: 10,
  y: 20,
  w: 100,
  h: 50,
  rotation: 30,
  opacity: 0.8,
  visible: true,
};

const parent = (): Plan => ({
  ...makeEmptyPlan({ id: "p", raid: "Amirdrassil", background: BACKGROUND }),
});

const colour: AttackParam = {
  name: "colour",
  label: "Colour",
  kind: "color",
  value: "#ff0000",
  targets: [{ on: "object", targetId: "puddle", field: "tint" }],
};

const def = (over: Partial<AttackDef> = {}): AttackDef => ({
  id: "def_1",
  name: "Fireball",
  source: "plan",
  objects: [
    { id: "puddle", type: "shape", shape: "voidzone", base: { ...box, z: 0 } },
    {
      id: "target",
      type: "token",
      slotName: "the tank",
      base: { ...box, z: 1 },
    },
  ],
  slide: {
    id: "def-slide",
    states: { puddle: box, target: { ...box, x: 400 } },
    animations: [
      {
        id: "a1",
        objectId: "puddle",
        kind: "entrance",
        effect: "appear",
        trigger: "onEnter",
        delayMs: 0,
        durationMs: 0,
        easing: "none",
      },
    ],
  },
  params: [colour],
  ...over,
});

describe("opening a definition as a plan", () => {
  it("is a valid plan, so the ordinary editor can hold it with no special case", () => {
    expect(() => PlanSchema.parse(attackToPlan(parent(), def()))).not.toThrow();
  });

  it("borrows the parent's background, so a mechanic is drawn against the map it is for", () => {
    expect(attackToPlan(parent(), def()).background).toEqual(BACKGROUND);
  });

  it("is exactly one slide — a thing that happens has one scene", () => {
    expect(attackToPlan(parent(), def()).slides).toHaveLength(1);
  });

  it("carries no attacks of its own", () => {
    expect(attackToPlan(parent(), def()).attacks).toEqual([]);
  });

  it("opens an empty board for a definition that doesn't exist yet", () => {
    const plan = attackToPlan(parent(), undefined);
    expect(plan.objects).toEqual([]);
    expect(plan.slides).toHaveLength(1);
    expect(plan.id).toBe(DESIGNER_PLAN_ID);
  });
});

describe("reading the sandbox back out", () => {
  const identity = { id: "def_1", name: "Fireball", source: "plan" as const };

  it("round-trips a definition unchanged, so opening and saving is a no-op", () => {
    const original = def();
    const back = planToAttack(
      attackToPlan(parent(), original),
      identity,
      original.params,
    );
    expect(back).toEqual(original);
  });

  it("keeps the slot, which is the one thing a plan could not have said", () => {
    const back = planToAttack(
      attackToPlan(parent(), def()),
      identity,
      def().params,
    );
    expect(back.objects.find((o) => o.id === "target")?.slotName).toBe(
      "the tank",
    );
  });

  it("falls back to a name rather than saving an unnamed attack", () => {
    const back = planToAttack(
      attackToPlan(parent(), def()),
      { ...identity, name: "   " },
      [],
    );
    expect(back.name).toBe("Untitled attack");
  });

  it("drops a parameter bound to something deleted while designing, which the stamp could never write", () => {
    const plan = attackToPlan(parent(), def());
    const withoutPuddle: Plan = {
      ...plan,
      objects: plan.objects.filter((o) => o.id !== "puddle"),
    };
    expect(planToAttack(withoutPuddle, identity, [colour]).params).toEqual([]);
  });

  it("keeps a parameter whose animation is still there", () => {
    const animParam: AttackParam = {
      name: "cast",
      label: "Cast",
      kind: "number",
      value: 500,
      targets: [{ on: "anim", targetId: "a1", field: "durationMs" }],
    };
    const kept = planToAttack(attackToPlan(parent(), def()), identity, [
      animParam,
    ]);
    expect(kept.params).toEqual([animParam]);
  });
});

describe("putting a definition into a plan's library", () => {
  it("appends one the plan doesn't have", () => {
    expect(upsertAttack(parent(), def()).attacks).toEqual([def()]);
  });

  it("replaces the one it supersedes, in place, so the palette doesn't reshuffle", () => {
    const plan = {
      ...parent(),
      attacks: [def({ id: "a" }), def({ id: "b" }), def({ id: "c" })],
    };
    const next = upsertAttack(plan, def({ id: "b", name: "Renamed" }));
    expect(next.attacks.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(next.attacks[1]!.name).toBe("Renamed");
  });

  it("leaves the plan it was given alone", () => {
    const plan = parent();
    upsertAttack(plan, def());
    expect(plan.attacks).toEqual([]);
  });
});
