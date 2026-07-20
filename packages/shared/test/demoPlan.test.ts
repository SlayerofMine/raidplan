import { describe, expect, it } from "vitest";
import {
  ANIM_EFFECTS,
  ANIM_KINDS,
  ANIM_TRIGGERS,
  SHAPE_KINDS,
} from "../src/effects.js";
import { MECH_EDGES, MECH_LINES } from "../src/mechanics.js";
import { PlanSchema } from "../src/plan.js";
import { buildDemoPlan } from "../src/demoPlan.js";

const plan = buildDemoPlan();
const objects = plan.objects;
const animations = plan.steps.flatMap((s) => s.animations);
const ids = new Set(objects.map((o) => o.id));

describe("demo plan — validity", () => {
  it("is a valid plan document", () => {
    const result = PlanSchema.safeParse(plan);
    // Surface the first issue rather than a bare `false`.
    if (!result.success)
      throw new Error(JSON.stringify(result.error.issues[0]));
    expect(result.success).toBe(true);
  });

  it("has unique object ids and unique animation ids", () => {
    expect(ids.size).toBe(objects.length);
    const animIds = new Set(animations.map((a) => a.id));
    expect(animIds.size).toBe(animations.length);
  });

  it("has no dangling references", () => {
    for (const a of animations) expect(ids).toContain(a.objectId);
    for (const step of plan.steps) {
      for (const id of Object.keys(step.overrides)) expect(ids).toContain(id);
    }
    for (const o of objects) {
      if (o.fromId) expect(ids).toContain(o.fromId);
      if (o.toId) expect(ids).toContain(o.toId);
    }
    for (const a of animations) {
      for (const id of a.collideWith ?? []) expect(ids).toContain(id);
    }
  });

  it("keeps every object inside the board", () => {
    // Tethers are the exception: their transform is degenerate by design.
    for (const o of objects.filter((x) => x.type !== "tether")) {
      expect(o.base.x).toBeGreaterThanOrEqual(0);
      expect(o.base.y).toBeGreaterThanOrEqual(0);
      expect(o.base.x + o.base.w).toBeLessThanOrEqual(plan.background.width);
      expect(o.base.y + o.base.h).toBeLessThanOrEqual(plan.background.height);
    }
  });
});

/**
 * The point of the fixture: it must exercise *everything*. These assertions are
 * what make it fail loudly when a new shape or effect is added and the demo
 * isn't regenerated.
 */
describe("demo plan — feature coverage", () => {
  it("uses every shape kind", () => {
    const used = new Set(objects.map((o) => o.shape).filter(Boolean));
    for (const kind of SHAPE_KINDS) expect(used).toContain(kind);
  });

  it("uses every animation effect, kind and trigger", () => {
    const effects = new Set(animations.map((a) => a.effect));
    const kinds = new Set(animations.map((a) => a.kind));
    const triggers = new Set(animations.map((a) => a.trigger));
    for (const e of ANIM_EFFECTS) expect(effects).toContain(e);
    for (const k of ANIM_KINDS) expect(kinds).toContain(k);
    for (const t of ANIM_TRIGGERS) expect(triggers).toContain(t);
  });

  it("shows both voidzone edges and both tether line styles", () => {
    const edges = new Set(objects.map((o) => o.style?.edge).filter(Boolean));
    for (const edge of MECH_EDGES) expect(edges).toContain(edge);

    const tethers = objects.filter((o) => o.type === "tether");
    expect(tethers.length).toBeGreaterThanOrEqual(MECH_LINES.length);
    // `squiggly` is the default, so an unstyled tether covers it.
    const lines = new Set(tethers.map((t) => t.style?.line ?? "squiggly"));
    for (const line of MECH_LINES) expect(lines).toContain(line);
  });

  it("covers the interesting fill treatments", () => {
    const fills = new Set(objects.map((o) => o.style?.fill).filter(Boolean));
    for (const fill of ["striped", "solid", "none", "hazard"]) {
      expect(fills).toContain(fill);
    }
    expect(objects.some((o) => o.style?.outline === false)).toBe(true);
  });
});

describe("demo plan — the collision demo actually collides", () => {
  const runner = objects.find((o) => o.id === "tok-runner")!;
  const orb = objects.find((o) => o.id === "orb")!;
  const step = plan.steps.find((s) => s.id === "step-collision")!;

  it("arms the orb against the runner", () => {
    const armed = step.animations.find((a) => a.trigger === "onCollision")!;
    expect(armed.objectId).toBe(orb.id);
    expect(armed.collideWith).toEqual([runner.id]);
  });

  it("routes the runner across the orb, on the same row", () => {
    const endX = step.overrides[runner.id]?.x;
    expect(endX).toBeDefined();
    // The orb sits between the runner's start and end...
    expect(orb.base.x).toBeGreaterThan(runner.base.x);
    expect(orb.base.x).toBeLessThan(endX!);
    // ...and their rows overlap, so the bounding boxes really do intersect.
    const runnerBottom = runner.base.y + runner.base.h;
    const orbBottom = orb.base.y + orb.base.h;
    expect(runner.base.y).toBeLessThan(orbBottom);
    expect(orb.base.y).toBeLessThan(runnerBottom);
  });
});
