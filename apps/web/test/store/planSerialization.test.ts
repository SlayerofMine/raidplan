import { describe, expect, it } from "vitest";
import { PlanSchema, SCHEMA_VERSION, type Plan } from "@raidplan/shared";
import {
  fromPlan,
  toPlan,
  type PlanDoc,
} from "../../src/store/planSerialization";

function plan(): Plan {
  return {
    id: "plan_1",
    title: "Test",
    raid: "test-raid",
    background: { assetId: "arena", width: 1600, height: 900 },
    objects: [
      {
        id: "a",
        type: "token",
        iconId: "marker-1",
        base: {
          x: 1,
          y: 2,
          w: 64,
          h: 64,
          rotation: 0,
          opacity: 1,
          z: 0,
          visible: true,
        },
      },
      {
        id: "b",
        type: "shape",
        shape: "circle",
        base: {
          x: 3,
          y: 4,
          w: 100,
          h: 100,
          rotation: 45,
          opacity: 0.5,
          z: 1,
          visible: true,
        },
      },
    ],
    steps: [],
    schemaVersion: SCHEMA_VERSION,
  };
}

describe("plan serialization", () => {
  it("round-trips Plan → doc → Plan losslessly", () => {
    expect(toPlan(fromPlan(plan()))).toEqual(plan());
  });

  it("round-trips doc → Plan → doc losslessly", () => {
    const doc = fromPlan(plan());
    expect(fromPlan(toPlan(doc))).toEqual(doc);
  });

  it("normalizes objects into a map keyed by id, preserving order", () => {
    const doc = fromPlan(plan());
    expect(doc.objectIds).toEqual(["a", "b"]);
    expect(doc.objects.a?.type).toBe("token");
    expect(doc.objects.b?.shape).toBe("circle");
  });

  it("serializes objects in objectIds (z) order, not map order", () => {
    const doc = fromPlan(plan());
    doc.objectIds = ["b", "a"]; // reorder as the store would
    expect(toPlan(doc).objects.map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("drops ids in the order list that have no object", () => {
    const doc: PlanDoc = { ...fromPlan(plan()) };
    doc.objectIds = ["a", "ghost", "b"];
    expect(toPlan(doc).objects.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("produces a document that satisfies the shared schema", () => {
    expect(PlanSchema.safeParse(toPlan(fromPlan(plan()))).success).toBe(true);
  });

  it("carries steps through untouched (Phase 3 forward-compat)", () => {
    const withStep = plan();
    withStep.steps = [{ id: "s1", overrides: {}, animations: [] }];
    expect(toPlan(fromPlan(withStep)).steps).toEqual(withStep.steps);
  });
});
