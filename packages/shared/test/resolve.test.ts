import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type Plan,
  type PlanObject,
  type Step,
} from "../src/plan.js";
import {
  baseState,
  resolveObjectState,
  resolveSettledState,
  resolveStepStates,
} from "../src/resolve.js";

function obj(
  id: string,
  overrides: Partial<PlanObject["base"]> = {},
): PlanObject {
  return {
    id,
    type: "token",
    base: {
      x: 0,
      y: 0,
      w: 32,
      h: 32,
      rotation: 0,
      opacity: 1,
      z: 0,
      visible: true,
      ...overrides,
    },
  };
}

function step(id: string, overrides: Step["overrides"]): Step {
  return { id, overrides, animations: [] };
}

function plan(objects: PlanObject[], steps: Step[]): Plan {
  return {
    id: "plan_resolve",
    title: "Resolve fixture",
    raid: "test",
    background: { assetId: "bg", width: 1000, height: 1000 },
    objects,
    attacks: [],
    steps,
    schemaVersion: SCHEMA_VERSION,
  };
}

describe("baseState", () => {
  it("projects an object's base transform into a flat state", () => {
    expect(baseState(obj("a", { x: 10, y: 20, opacity: 0.5 }))).toEqual({
      x: 10,
      y: 20,
      w: 32,
      h: 32,
      rotation: 0,
      opacity: 0.5,
      visible: true,
    });
  });
});

describe("resolveObjectState", () => {
  it("returns the base state before any step", () => {
    const o = obj("a", { x: 5 });
    expect(resolveObjectState(o, [step("s0", { a: { x: 999 } })], -1)).toEqual(
      baseState(o),
    );
  });

  it("applies overrides up to and including the given step", () => {
    const o = obj("a");
    const steps = [
      step("s0", { a: { x: 100 } }),
      step("s1", { a: { y: 200 } }),
      step("s2", { a: { x: 300 } }),
    ];
    expect(resolveObjectState(o, steps, 0)).toMatchObject({ x: 100, y: 0 });
    expect(resolveObjectState(o, steps, 1)).toMatchObject({ x: 100, y: 200 });
    expect(resolveObjectState(o, steps, 2)).toMatchObject({ x: 300, y: 200 });
  });

  it("ignores steps that don't touch the object", () => {
    const o = obj("a", { x: 7 });
    expect(resolveObjectState(o, [step("s0", { other: { x: 1 } })], 0)).toEqual(
      baseState(o),
    );
  });

  it("clamps an over-large step index", () => {
    const o = obj("a");
    const steps = [step("s0", { a: { x: 100 } })];
    expect(resolveObjectState(o, steps, 999)).toEqual(
      resolveObjectState(o, steps, 0),
    );
  });

  it("agrees with resolveSettledState for the same object", () => {
    const p = plan(
      [obj("a", { x: 1 }), obj("b")],
      [step("s0", { a: { x: 100 } }), step("s1", { a: { opacity: 0.5 } })],
    );
    expect(resolveObjectState(p.objects[0]!, p.steps, 1)).toEqual(
      resolveSettledState(p, 1).a,
    );
  });

  it("does not mutate the object", () => {
    const o = obj("a", { x: 1 });
    const snapshot = structuredClone(o);
    resolveObjectState(o, [step("s0", { a: { x: 100 } })], 0);
    expect(o).toEqual(snapshot);
  });
});

describe("resolveSettledState", () => {
  it("returns base states for step -1 (before any step)", () => {
    const p = plan([obj("a", { x: 5 })], [step("s0", { a: { x: 999 } })]);
    expect(resolveSettledState(p, -1)).toEqual({
      a: baseState(p.objects[0]!),
    });
  });

  it("applies a single step's override", () => {
    const p = plan([obj("a")], [step("s0", { a: { x: 300, opacity: 0.2 } })]);
    const settled = resolveSettledState(p, 0);
    expect(settled.a).toMatchObject({ x: 300, opacity: 0.2 });
  });

  it("carries untouched fields forward (sparse overrides)", () => {
    const p = plan(
      [obj("a", { x: 1, y: 2, rotation: 45 })],
      [step("s0", { a: { x: 100 } })],
    );
    const settled = resolveSettledState(p, 0);
    // x changed; y and rotation inherited from base.
    expect(settled.a).toMatchObject({ x: 100, y: 2, rotation: 45 });
  });

  it("accumulates overrides across multiple steps in order", () => {
    const p = plan(
      [obj("a")],
      [
        step("s0", { a: { x: 100 } }),
        step("s1", { a: { y: 200 } }),
        step("s2", { a: { x: 300 } }), // x overwritten again
      ],
    );
    expect(resolveSettledState(p, 2).a).toMatchObject({ x: 300, y: 200 });
    // Intermediate settle is independent of later steps.
    expect(resolveSettledState(p, 1).a).toMatchObject({ x: 100, y: 200 });
    expect(resolveSettledState(p, 0).a).toMatchObject({ x: 100, y: 0 });
  });

  it("leaves objects with no override untouched", () => {
    const p = plan(
      [obj("a", { x: 1 }), obj("b", { x: 2 })],
      [step("s0", { a: { x: 100 } })],
    );
    const settled = resolveSettledState(p, 0);
    expect(settled.a).toMatchObject({ x: 100 });
    expect(settled.b).toMatchObject({ x: 2 });
  });

  it("clamps an over-large step index to the final settled state", () => {
    const p = plan([obj("a")], [step("s0", { a: { x: 100 } })]);
    expect(resolveSettledState(p, 999)).toEqual(resolveSettledState(p, 0));
  });

  it("ignores overrides that reference a non-existent object", () => {
    const p = plan([obj("a")], [step("s0", { ghost: { x: 100 } })]);
    const settled = resolveSettledState(p, 0);
    expect(settled.a).toMatchObject({ x: 0 });
    expect(settled).not.toHaveProperty("ghost");
  });

  it("does not mutate the input plan", () => {
    const p = plan([obj("a", { x: 1 })], [step("s0", { a: { x: 100 } })]);
    const snapshot = structuredClone(p);
    resolveSettledState(p, 0);
    expect(p).toEqual(snapshot);
  });
});

describe("resolveStepStates", () => {
  it("animates from the previous settle (start) to this step's settle (end)", () => {
    const p = plan(
      [obj("a", { x: 0 })],
      [step("s0", { a: { x: 100 } }), step("s1", { a: { x: 400 } })],
    );
    const { start, end } = resolveStepStates(p, 1);
    expect(start.a).toMatchObject({ x: 100 }); // settled state of step 0
    expect(end.a).toMatchObject({ x: 400 }); // settled state of step 1
  });

  it("starts step 0 from the base state", () => {
    const p = plan([obj("a", { x: 7 })], [step("s0", { a: { x: 100 } })]);
    const { start, end } = resolveStepStates(p, 0);
    expect(start.a).toMatchObject({ x: 7 });
    expect(end.a).toMatchObject({ x: 100 });
  });

  it("throws on an out-of-range step index", () => {
    const p = plan([obj("a")], [step("s0", {})]);
    expect(() => resolveStepStates(p, 1)).toThrow(RangeError);
    expect(() => resolveStepStates(p, -1)).toThrow(RangeError);
  });

  it("throws on a non-integer step index", () => {
    const p = plan([obj("a")], [step("s0", {})]);
    expect(() => resolveStepStates(p, 0.5)).toThrow(RangeError);
  });
});
