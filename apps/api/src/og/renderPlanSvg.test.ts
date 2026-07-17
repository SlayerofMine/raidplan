import { describe, expect, it } from "vitest";
import {
  ICONS,
  SCHEMA_VERSION,
  type Plan,
  type PlanObject,
} from "@raidplan/shared";
import { renderPlanSvg } from "./renderPlanSvg.js";

const token = (iconId: string): PlanObject => ({
  id: "o1",
  type: "token",
  iconId,
  base: {
    x: 10,
    y: 20,
    w: 64,
    h: 64,
    rotation: 0,
    opacity: 1,
    z: 0,
    visible: true,
  },
});

const plan = (objects: PlanObject[]): Plan => ({
  id: "p",
  title: "T",
  raid: "",
  background: { assetId: "no-such-bg", width: 400, height: 300 },
  objects,
  steps: [],
  schemaVersion: SCHEMA_VERSION,
});

describe("renderPlanSvg — synced icon tokens", () => {
  it("draws a synced token as an <image> from the provided inline images", () => {
    const svg = renderPlanSvg(plan([token("spell_fire_fireball02")]), -1, {
      iconImages: { spell_fire_fireball02: "data:image/png;base64,AAAA" },
    });
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
  });

  it("draws nothing for a synced token when its image wasn't resolved", () => {
    // e.g. the file was missing — the rest of the preview must still render.
    const svg = renderPlanSvg(plan([token("spell_fire_fireball02")]), -1, {});
    expect(svg).not.toContain("<image");
    expect(svg).toContain("</svg>"); // still a valid document
  });

  it("still inlines a bundled token's own markup (no regression)", () => {
    const bundled = ICONS[0]!; // e.g. marker-1
    const svg = renderPlanSvg(plan([token(bundled.id)]), -1, {});
    // Bundled icons draw from SVG markup, not an <image>.
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("<image");
  });
});
