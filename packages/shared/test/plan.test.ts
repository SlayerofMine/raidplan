import { describe, expect, it } from "vitest";
import {
  makeEmptyPlan,
  PlanSchema,
  SCHEMA_VERSION,
  StepOverrideSchema,
  type Plan,
} from "../src/plan.js";

/** A minimal, valid plan fixture with one object and one step. */
function validPlan(): Plan {
  return {
    id: "plan_1",
    title: "Mythic Test Boss",
    raid: "test-raid",
    background: { assetId: "bg_arena", width: 1920, height: 1080 },
    objects: [
      {
        id: "obj_1",
        type: "token",
        iconId: "class-warrior",
        base: {
          x: 100,
          y: 200,
          w: 48,
          h: 48,
          rotation: 0,
          opacity: 1,
          z: 0,
          visible: true,
        },
      },
    ],
    attacks: [],
    steps: [
      {
        id: "step_1",
        name: "Pull",
        overrides: { obj_1: { x: 300 } },
        animations: [
          {
            id: "anim_1",
            objectId: "obj_1",
            kind: "motion",
            effect: "move",
            trigger: "onEnter",
            delayMs: 0,
            durationMs: 500,
            easing: "power2.out",
          },
        ],
      },
    ],
    schemaVersion: SCHEMA_VERSION,
  };
}

describe("PlanSchema — valid documents parse", () => {
  it("accepts a fully-populated plan", () => {
    const result = PlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
  });

  it("accepts the empty plan produced by makeEmptyPlan", () => {
    const empty = makeEmptyPlan({
      id: "plan_empty",
      background: { assetId: "bg", width: 800, height: 600 },
    });
    expect(PlanSchema.safeParse(empty).success).toBe(true);
    expect(empty.schemaVersion).toBe(SCHEMA_VERSION);
    expect(empty.objects).toEqual([]);
    expect(empty.steps).toEqual([]);
  });

  it("preserves optional fields through a parse round-trip", () => {
    const plan = validPlan();
    plan.objects[0]!.base.tint = "#c69b6d";
    plan.objects[0]!.base.label = "MT";
    plan.steps[0]!.autoAdvanceMs = 2000;
    const parsed = PlanSchema.parse(plan);
    expect(parsed.objects[0]!.base.tint).toBe("#c69b6d");
    expect(parsed.steps[0]!.autoAdvanceMs).toBe(2000);
  });
});

describe("PlanSchema — malformed documents are rejected", () => {
  it("rejects an unknown object type", () => {
    const plan = validPlan() as unknown as { objects: { type: string }[] };
    plan.objects[0]!.type = "sasquatch";
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects opacity outside 0..1", () => {
    const plan = validPlan();
    plan.objects[0]!.base.opacity = 1.5;
    const result = PlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("opacity");
    }
  });

  it("rejects negative width", () => {
    const plan = validPlan();
    plan.objects[0]!.base.w = -1;
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a non-finite coordinate (NaN)", () => {
    const plan = validPlan();
    plan.objects[0]!.base.x = Number.NaN;
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects an empty object id", () => {
    const plan = validPlan();
    plan.objects[0]!.id = "";
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects an unknown animation trigger", () => {
    const plan = validPlan() as unknown as {
      attacks: [];
      steps: { animations: { trigger: string }[] }[];
    };
    plan.steps[0]!.animations[0]!.trigger = "someday";
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a background with zero width", () => {
    const plan = validPlan();
    plan.background.width = 0;
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a non-integer schemaVersion", () => {
    const plan = validPlan();
    plan.schemaVersion = 1.5;
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe("PlanObjectSchema — shape primitives", () => {
  it("accepts a shape object with a known shape kind", () => {
    const plan = validPlan();
    plan.objects.push({
      id: "obj_shape",
      type: "shape",
      shape: "circle",
      base: {
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        rotation: 0,
        opacity: 0.5,
        z: 1,
        visible: true,
      },
    });
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  it("rejects an unknown shape kind", () => {
    const plan = validPlan() as unknown as {
      objects: { type: string; shape?: string }[];
    };
    plan.objects[0]!.type = "shape";
    plan.objects[0]!.shape = "hexagon";
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });

  it("stays optional, so documents without it remain valid", () => {
    // `shape` is additive: a token has no shape and must still parse.
    const parsed = PlanSchema.parse(validPlan());
    expect(parsed.objects[0]!.shape).toBeUndefined();
  });

  it("accepts the new mechanic shape kinds", () => {
    for (const shape of ["cone", "line", "soak", "voidzone", "pickup"]) {
      const plan = validPlan();
      plan.objects.push({
        id: `obj_${shape}`,
        type: "shape",
        shape: shape as "cone",
        base: {
          x: 0,
          y: 0,
          w: 80,
          h: 80,
          rotation: 0,
          opacity: 1,
          z: 2,
          visible: true,
        },
      });
      expect(PlanSchema.safeParse(plan).success).toBe(true);
    }
  });
});

describe("AnimSchema — collision triggers", () => {
  it("accepts an onCollision animation and round-trips its collider group", () => {
    const plan = validPlan();
    plan.steps[0]!.animations.push({
      id: "anim_hit",
      objectId: "obj_1",
      kind: "exit",
      effect: "disappear",
      trigger: "onCollision",
      collideWith: ["obj_2", "obj_3"],
      delayMs: 0,
      durationMs: 300,
      easing: "none",
    });
    const parsed = PlanSchema.parse(plan);
    const hit = parsed.steps[0]!.animations.find((a) => a.id === "anim_hit")!;
    expect(hit.trigger).toBe("onCollision");
    expect(hit.collideWith).toEqual(["obj_2", "obj_3"]);
  });

  it("leaves collideWith optional, so ordinary animations are unchanged", () => {
    const parsed = PlanSchema.parse(validPlan());
    expect(parsed.steps[0]!.animations[0]!.collideWith).toBeUndefined();
  });

  it("rejects an empty collider id", () => {
    const plan = validPlan();
    plan.steps[0]!.animations[0]!.collideWith = [""];
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
});

describe("PlanObjectSchema — tethers", () => {
  it("accepts a tether linking two objects and round-trips its endpoints", () => {
    const plan = validPlan();
    plan.objects.push({
      id: "obj_2",
      type: "marker",
      base: {
        x: 400,
        y: 400,
        w: 48,
        h: 48,
        rotation: 0,
        opacity: 1,
        z: 1,
        visible: true,
      },
    });
    plan.objects.push({
      id: "obj_tether",
      type: "tether",
      fromId: "obj_1",
      toId: "obj_2",
      base: {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        rotation: 0,
        opacity: 1,
        z: 2,
        visible: true,
      },
    });
    const parsed = PlanSchema.parse(plan);
    const tether = parsed.objects.find((o) => o.id === "obj_tether")!;
    expect(tether.type).toBe("tether");
    expect(tether.fromId).toBe("obj_1");
    expect(tether.toId).toBe("obj_2");
  });
});

describe("StepOverrideSchema", () => {
  it("accepts an empty override (no-op step for an object)", () => {
    expect(StepOverrideSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a partial override touching only one field", () => {
    expect(StepOverrideSchema.safeParse({ x: 42 }).success).toBe(true);
  });

  it("rejects an out-of-range opacity override", () => {
    expect(StepOverrideSchema.safeParse({ opacity: 2 }).success).toBe(false);
  });
});
