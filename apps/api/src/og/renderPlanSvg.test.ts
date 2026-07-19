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

const shape = (
  shapeKind: PlanObject["shape"],
  tint: string,
  id = "s1",
): PlanObject => ({
  id,
  type: "shape",
  shape: shapeKind,
  base: {
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    opacity: 1,
    z: 0,
    visible: true,
    tint,
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

describe("renderPlanSvg — mechanic shapes", () => {
  it("draws each mechanic with the object's tint", () => {
    for (const kind of [
      "cone",
      "line",
      "soak",
      "voidzone",
      "pickup",
    ] as const) {
      const svg = renderPlanSvg(plan([shape(kind, "#33cc99")]), -1);
      expect(svg).toContain("#33cc99");
    }
  });

  it("gives a voidzone a radial hazard fill (unlike a plain circle)", () => {
    const voidSvg = renderPlanSvg(plan([shape("voidzone", "#ff4444")]), -1);
    expect(voidSvg).toContain('<radialGradient id="hz-s1"');
    expect(voidSvg).toContain('fill="url(#hz-s1)"');

    const circleSvg = renderPlanSvg(plan([shape("circle", "#ff4444")]), -1);
    expect(circleSvg).not.toContain("radialGradient");
  });

  it("draws a soak as a dashed ring plus inward chevrons", () => {
    const svg = renderPlanSvg(plan([shape("soak", "#4488ff")]), -1);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain("<polyline"); // the inward chevrons
  });
});

describe("renderPlanSvg — tethers", () => {
  const at = (id: string, x: number, y: number): PlanObject => ({
    id,
    type: "marker",
    base: { x, y, w: 64, h: 64, rotation: 0, opacity: 1, z: 0, visible: true },
  });
  const tether: PlanObject = {
    id: "t1",
    type: "tether",
    fromId: "a",
    toId: "b",
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
  };

  it("draws a line starting at the first endpoint's centre", () => {
    // a at (10,20) w/h 64 → centre (42,52).
    const svg = renderPlanSvg(
      plan([at("a", 10, 20), at("b", 200, 20), tether]),
      -1,
    );
    expect(svg).toContain("<path");
    expect(svg).toContain("M42 52");
  });

  it("follows its endpoints across steps", () => {
    const p = plan([at("a", 10, 20), at("b", 200, 20), tether]);
    p.steps = [{ id: "s", overrides: { a: { x: 210 } }, animations: [] }];
    // On step 0, `a` has moved to x=210 → centre x=242.
    const svg = renderPlanSvg(p, 0);
    expect(svg).toContain("M242 52");
  });

  it("draws nothing when an endpoint is missing", () => {
    const svg = renderPlanSvg(plan([at("a", 10, 20), tether]), -1); // no "b"
    // The tether itself contributes no path; the surviving marker still renders.
    expect(svg).not.toContain("<path");
    expect(svg).toContain("</svg>");
  });
});
