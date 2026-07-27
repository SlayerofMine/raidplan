import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type Plan,
  type PlanObject,
  type Slide,
  type SlideState,
} from "../src/plan.js";
import {
  normalizeSlides,
  resolveObjectState,
  resolveSlideStates,
  resolveSlideTransition,
  seedState,
} from "../src/resolve.js";

function obj(id: string, base: Partial<PlanObject["base"]> = {}): PlanObject {
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
      ...base,
    },
  };
}

/** A complete state, so a fixture only has to say the parts it cares about. */
function state(over: Partial<SlideState> = {}): SlideState {
  return {
    x: 0,
    y: 0,
    w: 32,
    h: 32,
    rotation: 0,
    opacity: 1,
    visible: true,
    ...over,
  };
}

function slide(id: string, states: Record<string, SlideState>): Slide {
  return { id, states, animations: [] };
}

function plan(objects: PlanObject[], slides: Slide[]): Plan {
  return {
    id: "plan_resolve",
    title: "Resolve fixture",
    raid: "test",
    background: { assetId: "bg", width: 1000, height: 1000 },
    objects,
    attacks: [],
    slides,
    schemaVersion: SCHEMA_VERSION,
  };
}

describe("seedState", () => {
  it("projects an object's creation transform into a flat state", () => {
    expect(seedState(obj("a", { x: 10, y: 20, opacity: 0.5 }))).toEqual({
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
  it("reads the slide's own state, with nothing carried in from before it", () => {
    const o = obj("a");
    const slides = [
      slide("s0", { a: state({ x: 100 }) }),
      // y moves here and x is *not* restated — under the old cascading model x
      // would have carried 100 forward. It doesn't: a slide says everything.
      slide("s1", { a: state({ y: 200 }) }),
    ];
    expect(resolveObjectState(o, slides, 0)).toMatchObject({ x: 100, y: 0 });
    expect(resolveObjectState(o, slides, 1)).toMatchObject({ x: 0, y: 200 });
  });

  it("clamps an over-large slide index to the last slide", () => {
    const o = obj("a");
    const slides = [slide("s0", { a: state({ x: 100 }) })];
    expect(resolveObjectState(o, slides, 999)).toEqual(
      resolveObjectState(o, slides, 0),
    );
  });

  it("clamps a negative slide index to the first slide", () => {
    const o = obj("a", { x: 7 });
    const slides = [slide("s0", { a: state({ x: 100 }) })];
    expect(resolveObjectState(o, slides, -1)).toMatchObject({ x: 100 });
  });

  it("falls back to the seed when a slide has no entry for the object", () => {
    const o = obj("a", { x: 7, y: 9 });
    expect(resolveObjectState(o, [slide("s0", {})], 0)).toEqual(seedState(o));
  });

  it("falls back to the seed when there are no slides at all", () => {
    const o = obj("a", { x: 7 });
    expect(resolveObjectState(o, [], 0)).toEqual(seedState(o));
  });

  it("agrees with resolveSlideStates for the same object", () => {
    const p = plan(
      [obj("a"), obj("b")],
      [
        slide("s0", { a: state({ x: 100 }), b: state() }),
        slide("s1", { a: state({ opacity: 0.5 }), b: state() }),
      ],
    );
    expect(resolveObjectState(p.objects[0]!, p.slides, 1)).toEqual(
      resolveSlideStates(p, 1).a,
    );
  });

  it("returns a copy, so a caller can't write through into the document", () => {
    const o = obj("a");
    const slides = [slide("s0", { a: state({ x: 1 }) })];
    const resolved = resolveObjectState(o, slides, 0);
    resolved.x = 999;
    expect(slides[0]!.states.a!.x).toBe(1);
  });

  it("does not mutate the object", () => {
    const o = obj("a", { x: 1 });
    const snapshot = structuredClone(o);
    resolveObjectState(o, [slide("s0", { a: state({ x: 100 }) })], 0);
    expect(o).toEqual(snapshot);
  });
});

describe("resolveSlideStates", () => {
  it("resolves every object on the slide", () => {
    const p = plan(
      [obj("a"), obj("b")],
      [slide("s0", { a: state({ x: 300, opacity: 0.2 }), b: state({ x: 2 }) })],
    );
    const settled = resolveSlideStates(p, 0);
    expect(settled.a).toMatchObject({ x: 300, opacity: 0.2 });
    expect(settled.b).toMatchObject({ x: 2 });
  });

  it("is independent per slide — a later slide can't reach an earlier one", () => {
    const p = plan(
      [obj("a")],
      [
        slide("s0", { a: state({ x: 100 }) }),
        slide("s1", { a: state({ x: 100, y: 200 }) }),
        slide("s2", { a: state({ x: 300, y: 200 }) }),
      ],
    );
    expect(resolveSlideStates(p, 0).a).toMatchObject({ x: 100, y: 0 });
    expect(resolveSlideStates(p, 1).a).toMatchObject({ x: 100, y: 200 });
    expect(resolveSlideStates(p, 2).a).toMatchObject({ x: 300, y: 200 });
  });

  it("clamps an over-large slide index to the final layout", () => {
    const p = plan([obj("a")], [slide("s0", { a: state({ x: 100 }) })]);
    expect(resolveSlideStates(p, 999)).toEqual(resolveSlideStates(p, 0));
  });

  it("ignores a state naming an object that no longer exists", () => {
    const p = plan(
      [obj("a")],
      [slide("s0", { a: state(), ghost: state({ x: 100 }) })],
    );
    const settled = resolveSlideStates(p, 0);
    expect(settled.a).toMatchObject({ x: 0 });
    expect(settled).not.toHaveProperty("ghost");
  });

  it("does not mutate the input plan", () => {
    const p = plan([obj("a")], [slide("s0", { a: state({ x: 100 }) })]);
    const snapshot = structuredClone(p);
    resolveSlideStates(p, 0);
    expect(p).toEqual(snapshot);
  });
});

describe("resolveSlideTransition", () => {
  it("animates from the previous slide's layout to this one's", () => {
    const p = plan(
      [obj("a")],
      [
        slide("s0", { a: state({ x: 100 }) }),
        slide("s1", { a: state({ x: 400 }) }),
      ],
    );
    const { start, end } = resolveSlideTransition(p, 1);
    expect(start.a).toMatchObject({ x: 100 });
    expect(end.a).toMatchObject({ x: 400 });
  });

  it("makes slide 0 static — it has nothing before it to move from", () => {
    const p = plan(
      [obj("a", { x: 7 })],
      [slide("s0", { a: state({ x: 100 }) })],
    );
    const { start, end } = resolveSlideTransition(p, 0);
    expect(start).toEqual(end);
    expect(start.a).toMatchObject({ x: 100 });
  });

  it("throws on an out-of-range slide index", () => {
    const p = plan([obj("a")], [slide("s0", { a: state() })]);
    expect(() => resolveSlideTransition(p, 1)).toThrow(RangeError);
    expect(() => resolveSlideTransition(p, -1)).toThrow(RangeError);
  });

  it("throws on a non-integer slide index", () => {
    const p = plan([obj("a")], [slide("s0", { a: state() })]);
    expect(() => resolveSlideTransition(p, 0.5)).toThrow(RangeError);
  });
});

describe("normalizeSlides", () => {
  it("fills a missing entry from the slide before it", () => {
    const objects = [obj("a")];
    const slides = [slide("s0", { a: state({ x: 50 }) }), slide("s1", {})];
    const fixed = normalizeSlides(objects, slides);
    expect(fixed[1]!.states.a).toMatchObject({ x: 50 });
  });

  it("fills a missing entry on the first slide from the object's seed", () => {
    const fixed = normalizeSlides([obj("a", { x: 12 })], [slide("s0", {})]);
    expect(fixed[0]!.states.a).toMatchObject({ x: 12 });
  });

  it("drops entries for objects that no longer exist", () => {
    const fixed = normalizeSlides(
      [obj("a")],
      [slide("s0", { a: state(), ghost: state({ x: 5 }) })],
    );
    expect(Object.keys(fixed[0]!.states)).toEqual(["a"]);
  });

  it("is idempotent", () => {
    const objects = [obj("a"), obj("b")];
    const once = normalizeSlides(objects, [
      slide("s0", { a: state({ x: 1 }) }),
      slide("s1", {}),
    ]);
    expect(normalizeSlides(objects, once)).toEqual(once);
  });

  it("leaves an already-dense slide referentially untouched", () => {
    const objects = [obj("a")];
    const original = slide("s0", { a: state({ x: 3 }) });
    const fixed = normalizeSlides(objects, [original]);
    // The store's `sameDocument` compares slices by reference, so a no-op
    // normalize that returned fresh objects would mark every load as dirty.
    expect(fixed[0]).toBe(original);
  });

  it("keeps each slide's animations and name", () => {
    const fixed = normalizeSlides(
      [obj("a")],
      [{ id: "s0", name: "Opening", states: {}, animations: [] }],
    );
    expect(fixed[0]).toMatchObject({ id: "s0", name: "Opening" });
  });
});
