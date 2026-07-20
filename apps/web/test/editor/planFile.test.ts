import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Plan } from "@raidplan/shared";
import { parsePlanJson, planToJson, slugify } from "../../src/editor/planFile";

function plan(): Plan {
  return {
    id: "local",
    title: "Mythic Boss",
    raid: "",
    background: { assetId: "arena", width: 1600, height: 900 },
    objects: [],
    steps: [],
    schemaVersion: SCHEMA_VERSION,
  };
}

describe("slugify", () => {
  it("makes a filesystem-safe name", () => {
    expect(slugify("Mythic Boss — P2!")).toBe("mythic-boss-p2");
  });

  it("falls back to 'plan' when nothing survives", () => {
    expect(slugify("   ")).toBe("plan");
    expect(slugify("!!!")).toBe("plan");
  });
});

describe("parsePlanJson", () => {
  it("accepts a valid exported plan (export → import round-trip)", () => {
    const result = parsePlanJson(planToJson(plan()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toEqual(plan());
  });

  it("rejects malformed JSON with a message, without throwing", () => {
    const result = parsePlanJson("{oops");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/i);
  });

  it("rejects JSON that isn't a plan", () => {
    const result = parsePlanJson(JSON.stringify({ hello: "world" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/RaidPlans plan/i);
  });

  it("rejects a plan with an out-of-range opacity", () => {
    const bad = plan() as unknown as { objects: unknown[] };
    bad.objects = [
      {
        id: "a",
        type: "token",
        base: {
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          rotation: 0,
          opacity: 5,
          z: 0,
          visible: true,
        },
      },
    ];
    expect(parsePlanJson(JSON.stringify(bad)).ok).toBe(false);
  });
});
