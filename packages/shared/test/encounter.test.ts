import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENCOUNTERS,
  EncounterPresetSchema,
  makePlanFromPreset,
} from "../src/encounter.js";
import { BACKGROUNDS } from "../src/assets/backgrounds.js";
import { PlanSchema } from "../src/plan.js";

const background = { assetId: "arena", width: 1600, height: 900 };

describe("EncounterPresetSchema", () => {
  it("defaults objects and steps to empty, so a bare preset is just a map", () => {
    const preset = EncounterPresetSchema.parse({ background });
    expect(preset.objects).toEqual([]);
    expect(preset.steps).toEqual([]);
  });

  it("rejects a preset without a background", () => {
    expect(EncounterPresetSchema.safeParse({}).success).toBe(false);
  });
});

describe("makePlanFromPreset", () => {
  it("stamps a valid Plan carrying the preset's background, objects and steps", () => {
    const object = {
      id: "boss",
      type: "token" as const,
      base: {
        x: 800,
        y: 450,
        w: 64,
        h: 64,
        rotation: 0,
        opacity: 1,
        z: 0,
        visible: true,
      },
    };
    const plan = makePlanFromPreset({
      id: "plan-1",
      title: "Pull 1",
      raid: "Sandbox",
      preset: { background, objects: [object], steps: [] },
    });

    // A round-trip through the document schema proves it's a real, valid plan.
    expect(() => PlanSchema.parse(plan)).not.toThrow();
    expect(plan.id).toBe("plan-1");
    expect(plan.title).toBe("Pull 1");
    expect(plan.raid).toBe("Sandbox");
    expect(plan.background).toEqual(background);
    expect(plan.objects).toEqual([object]);
  });

  it("falls back to the empty-plan defaults when title/raid are omitted", () => {
    const plan = makePlanFromPreset({
      id: "plan-2",
      preset: { background, objects: [], steps: [] },
    });
    expect(plan.title).toBe("Untitled plan");
    expect(plan.raid).toBe("");
  });
});

describe("DEFAULT_ENCOUNTERS", () => {
  it("mirrors the bundled maps under one raid, with unique slugs", () => {
    expect(DEFAULT_ENCOUNTERS).toHaveLength(BACKGROUNDS.length);
    expect(DEFAULT_ENCOUNTERS.every((e) => e.raid === "Sandbox")).toBe(true);
    const slugs = DEFAULT_ENCOUNTERS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("ships valid, icon-free presets so seeding needs no icon sync", () => {
    for (const encounter of DEFAULT_ENCOUNTERS) {
      expect(() => EncounterPresetSchema.parse(encounter.preset)).not.toThrow();
      expect(encounter.preset.objects).toEqual([]);
    }
  });
});
