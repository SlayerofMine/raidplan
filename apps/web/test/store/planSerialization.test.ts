import { describe, expect, it } from "vitest";
import { PlanSchema, SCHEMA_VERSION, type Plan } from "@raidplan/shared";
import {
  fromPlan,
  PLAN_DOC_KEYS,
  sameDocument,
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
    attacks: [],
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

/**
 * Autosave, remote save and undo all ask "did the document change?". They used
 * to each carry their own list of fields, and `attacks` was missed by all
 * three — so a plan whose only content was an attack never saved at all.
 */
describe("sameDocument", () => {
  const doc = (): PlanDoc => fromPlan(plan());

  it("covers every slice of the document", () => {
    // The compile-time guard is `DOC_SLICES`; this is the readable statement of
    // the same thing, and it fails loudly if a field is dropped from the list.
    expect([...PLAN_DOC_KEYS].sort()).toEqual(
      Object.keys(doc() satisfies PlanDoc).sort(),
    );
  });

  it("sees an edit to any slice, attacks included", () => {
    // A fresh value for one slice at a time; reference inequality is the
    // signal, exactly as immer produces it for a touched slice.
    const edited = (value: unknown) =>
      typeof value === "object" && value !== null
        ? structuredClone(value)
        : `${String(value)}-edited`;

    const before = doc();
    for (const key of PLAN_DOC_KEYS) {
      const after = { ...before, [key]: edited(before[key]) };
      expect(sameDocument(before, after), `missed a change to ${key}`).toBe(
        false,
      );
    }
  });

  it("ignores everything that isn't the document", () => {
    const before = doc();
    // Camera and selection live beside these slices and must not trigger saves.
    expect(sameDocument(before, { ...before })).toBe(true);
  });
});
