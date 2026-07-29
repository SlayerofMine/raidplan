import { describe, expect, it } from "vitest";
import type { AttackInstance } from "../src/attack.js";
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
  settledStates,
  seedState,
  stateBeforeAnim,
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

function move(
  objectId: string,
  params: Slide["animations"][number]["params"],
): Slide["animations"][number] {
  return { ...anim(objectId), ...(params ? { params } : {}) };
}

function anim(objectId: string): Slide["animations"][number] {
  return {
    id: `anim_${objectId}`,
    objectId,
    kind: "motion",
    effect: "move",
    trigger: "onEnter",
    delayMs: 0,
    durationMs: 500,
    easing: "power2.out",
  };
}

function plan(objects: PlanObject[], slides: Slide[]): Plan {
  return {
    id: "plan_resolve",
    title: "Resolve fixture",
    raid: "test",
    attacks: [],
    background: { assetId: "bg", width: 1000, height: 1000 },
    objects,
    groups: {},
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

  it("is invisible on a slide it is not on", () => {
    const o = obj("a", { x: 7, y: 9 });
    expect(resolveObjectState(o, [slide("s0", {})], 0)).toEqual({
      ...seedState(o),
      visible: false,
    });
  });

  it("borrows its geometry from the last slide that had it", () => {
    // So a token that leaves the scene fades out where it stood, rather than
    // snapping back to wherever it was first dropped.
    const o = obj("a", { x: 7 });
    const slides = [slide("s0", { a: state({ x: 300 }) }), slide("s1", {})];
    expect(resolveObjectState(o, slides, 1)).toMatchObject({
      x: 300,
      visible: false,
    });
  });

  it("looks forward when no earlier slide has it", () => {
    // An entrance on slide 2 starts from where slide 2 puts it, so a fade-in
    // happens in place instead of sliding in from the object's creation point.
    const o = obj("a", { x: 7 });
    const slides = [slide("s0", {}), slide("s1", { a: state({ x: 400 }) })];
    expect(resolveObjectState(o, slides, 0)).toMatchObject({
      x: 400,
      visible: false,
    });
  });

  it("falls back to the seed, hidden, when there are no slides at all", () => {
    const o = obj("a", { x: 7 });
    expect(resolveObjectState(o, [], 0)).toEqual({
      ...seedState(o),
      visible: false,
    });
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

/**
 * Where a slide leaves things — its opening layout with its own `move`s applied.
 * Editor-only: it is how "continue from this slide" knows to carry a token to
 * the end of its journey rather than back to where the journey started.
 */
describe("settledStates", () => {
  it("leaves an object where its move ends", () => {
    const s = settledStates({
      id: "s0",
      states: { a: state({ x: 100, y: 100 }) },
      animations: [move("a", { toX: 700, toY: 250 })],
    });
    expect(s["a"]).toMatchObject({ x: 700, y: 250 });
  });

  it("leaves an undrawn move alone — it goes nowhere", () => {
    const s = settledStates({
      id: "s0",
      states: { a: state({ x: 100 }) },
      animations: [move("a", {})],
    });
    expect(s["a"]).toMatchObject({ x: 100 });
  });

  it("follows a chain of moves to the last one", () => {
    const s = settledStates({
      id: "s0",
      states: { a: state({ x: 0 }) },
      animations: [move("a", { toX: 200 }), move("a", { toX: 800 })],
    });
    expect(s["a"]).toMatchObject({ x: 800 });
  });

  it("ignores animations belonging to another object", () => {
    const s = settledStates({
      id: "s0",
      states: { a: state({ x: 10 }), b: state({ x: 20 }) },
      animations: [move("b", { toX: 900 })],
    });
    expect(s["a"]).toMatchObject({ x: 10 });
    expect(s["b"]).toMatchObject({ x: 900 });
  });
});

/**
 * Where an object stands when one particular animation is about to play — the
 * rule a chain of `move`s hangs on. A drawn route is one move per leg, so leg
 * two has to know it starts at leg one's destination.
 */
describe("stateBeforeAnim", () => {
  const leg = (id: string, objectId: string, toX: number) => ({
    ...anim(objectId),
    id,
    params: { toX },
  });

  it("folds in the animations before it, and none after", () => {
    const animations = [
      leg("a1", "a", 200),
      leg("a2", "a", 500),
      leg("a3", "a", 900),
    ];
    const before = stateBeforeAnim(state({ x: 0 }), animations, "a", "a2");
    expect(before).toMatchObject({ x: 200 });
  });

  it("is the opening state for the first animation", () => {
    const animations = [leg("a1", "a", 200), leg("a2", "a", 500)];
    expect(
      stateBeforeAnim(state({ x: 40 }), animations, "a", "a1"),
    ).toMatchObject({ x: 40 });
  });

  it("means 'after everything' for an animation the slide doesn't have", () => {
    // Which is what a *new* move, appended to the slide, wants to know.
    const animations = [leg("a1", "a", 200), leg("a2", "a", 500)];
    expect(stateBeforeAnim(state({ x: 0 }), animations, "a")).toMatchObject({
      x: 500,
    });
  });

  it("ignores the other objects' animations, wherever they sit", () => {
    const animations = [
      leg("b1", "b", 900),
      leg("a1", "a", 200),
      leg("a2", "a", 500),
    ];
    expect(
      stateBeforeAnim(state({ x: 0 }), animations, "a", "a2"),
    ).toMatchObject({ x: 200 });
  });

  it("skips a deferred leg — a click that may never come promises nothing", () => {
    const animations = [
      { ...leg("a1", "a", 200), trigger: "onClick" as const },
      leg("a2", "a", 500),
    ];
    expect(
      stateBeforeAnim(state({ x: 0 }), animations, "a", "a2"),
    ).toMatchObject({ x: 0 });
  });
});

describe("normalizeSlides", () => {
  it("leaves a missing entry missing — that is the object not being there", () => {
    const objects = [obj("a")];
    const slides = [slide("s0", { a: state({ x: 50 }) }), slide("s1", {})];
    const fixed = normalizeSlides(objects, slides);
    expect(fixed[1]!.states.a).toBeUndefined();
  });

  it("drops animations for objects that no longer exist", () => {
    const fixed = normalizeSlides(
      [obj("a")],
      [
        {
          id: "s0",
          states: { a: state() },
          animations: [anim("ghost"), anim("a")],
        },
      ],
    );
    expect(fixed[0]!.animations.map((x) => x.objectId)).toEqual(["a"]);
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

  describe("attack instances (plan §21)", () => {
    const recipe = (over: Partial<AttackInstance> = {}): AttackInstance => ({
      id: "atk_1",
      defId: "def_1",
      name: "Fireball",
      transform: { tx: 0, ty: 0, rotationDeg: 0, sx: 1, sy: 1 },
      timeScale: 1,
      anchorDelayMs: 0,
      values: {},
      slots: { slot_1: "a" },
      objectMap: { def_puddle: "a" },
      animMap: { def_move: "anim_a" },
      ...over,
    });

    /** An object the instance owns — membership is what keeps the instance alive. */
    const owned = (id: string, attackId: string): PlanObject => ({
      ...obj(id),
      attackId,
    });

    it("keeps an instance that still owns an object", () => {
      const fixed = normalizeSlides(
        [owned("a", "atk_1")],
        [
          {
            id: "s0",
            states: { a: state() },
            animations: [anim("a")],
            attackInstances: { atk_1: recipe() },
          },
        ],
      );
      expect(Object.keys(fixed[0]!.attackInstances ?? {})).toEqual(["atk_1"]);
    });

    it("drops an instance whose last object has gone, exactly as a group dissolves", () => {
      const fixed = normalizeSlides(
        [obj("a")], // 'a' is no longer owned by the attack
        [
          {
            id: "s0",
            states: { a: state() },
            animations: [],
            attackInstances: { atk_1: recipe() },
          },
        ],
      );
      expect(fixed[0]!.attackInstances).toEqual({});
    });

    it("prunes ids that name objects and animations the plan no longer has, so a re-stamp cannot write through a stale reference", () => {
      const fixed = normalizeSlides(
        [owned("a", "atk_1")],
        [
          {
            id: "s0",
            states: { a: state() },
            animations: [anim("a")],
            attackInstances: {
              atk_1: recipe({
                slots: { slot_1: "a", slot_2: "ghost" },
                objectMap: { def_puddle: "a", def_bolt: "ghost" },
                animMap: { def_move: "anim_a", def_gone: "anim_ghost" },
              }),
            },
          },
        ],
      );
      const instance = fixed[0]!.attackInstances!.atk_1!;
      expect(instance.slots).toEqual({ slot_1: "a" });
      expect(instance.objectMap).toEqual({ def_puddle: "a" });
      expect(instance.animMap).toEqual({ def_move: "anim_a" });
    });

    it("leaves a clean slide's instances referentially untouched", () => {
      const original: Slide = {
        id: "s0",
        states: { a: state() },
        animations: [anim("a")],
        attackInstances: { atk_1: recipe() },
      };
      const fixed = normalizeSlides([owned("a", "atk_1")], [original]);
      expect(fixed[0]).toBe(original);
    });
  });

  it("leaves an already-clean slide referentially untouched", () => {
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
