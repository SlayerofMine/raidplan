import { describe, expect, it, vi } from "vitest";
import type {
  Anim,
  ObjectState,
  ResolvedStates,
  Slide,
} from "@raidplan/shared";
import { compileStep, isDeferred } from "../../src/anim/compileStep";

function state(over: Partial<ObjectState> = {}): ObjectState {
  return {
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    ...over,
  };
}

function anim(over: Partial<Anim> = {}): Anim {
  return {
    id: "anim_1",
    objectId: "a",
    kind: "motion",
    effect: "move",
    trigger: "onEnter",
    delayMs: 0,
    durationMs: 500,
    easing: "none",
    ...over,
  };
}

function slide(animations: Anim[]): Slide {
  return { id: "s1", states: {}, animations };
}

/** Compile and collect the values pushed at each object. */
function harness(s: Slide, states: ResolvedStates) {
  const applied: Record<string, Partial<ObjectState>> = {};
  const onUpdate = vi.fn();
  const { timeline, initial } = compileStep({
    slide: s,
    states,
    apply: (id, props) => {
      applied[id] = { ...applied[id], ...props };
    },
    onUpdate,
  });
  return {
    timeline,
    initial,
    applied,
    updates: () => onUpdate.mock.calls.length,
  };
}

describe("compileStep — timeline shape", () => {
  it("returns a paused timeline so the caller controls playback", () => {
    const { timeline } = harness(slide([anim()]), { a: state() });
    expect(timeline.paused()).toBe(true);
  });

  it("an empty slide compiles to a zero-length timeline", () => {
    const { timeline } = harness(slide([]), {});
    expect(timeline.duration()).toBe(0);
  });

  it("onEnter animations all start at t=0", () => {
    const s = slide([
      anim({ id: "1", objectId: "a", trigger: "onEnter", durationMs: 500 }),
      anim({ id: "2", objectId: "b", trigger: "onEnter", durationMs: 800 }),
    ]);
    const states = { a: state(), b: state() };
    const { timeline } = harness(s, states);
    // Both start together, so the slide lasts as long as the longest.
    expect(timeline.duration()).toBeCloseTo(0.8);
  });

  it("afterPrevious appends, so durations add up", () => {
    const s = slide([
      anim({ id: "1", objectId: "a", durationMs: 500 }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "afterPrevious",
        durationMs: 500,
      }),
    ]);
    const states = { a: state(), b: state() };
    const { timeline } = harness(s, states);
    expect(timeline.duration()).toBeCloseTo(1);
  });

  it("withPrevious starts alongside the previous animation", () => {
    const s = slide([
      anim({ id: "1", objectId: "a", durationMs: 500 }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "withPrevious",
        durationMs: 500,
      }),
    ]);
    const states = { a: state(), b: state() };
    const { timeline } = harness(s, states);
    expect(timeline.duration()).toBeCloseTo(0.5);
  });

  it("applies delayMs on top of the trigger position", () => {
    const s = slide([anim({ durationMs: 500, delayMs: 250 })]);
    const states = { a: state() };
    const { timeline } = harness(s, states);
    expect(timeline.duration()).toBeCloseTo(0.75);
  });

  it("excludes deferred (click/collision) animations from the slide timeline", () => {
    const states = { a: state() };
    for (const trigger of ["onClick", "onCollision"] as const) {
      const s = slide([anim({ trigger, durationMs: 500 })]);
      expect(harness(s, states).timeline.duration()).toBe(0);
    }
    expect(isDeferred(anim({ trigger: "onClick" }))).toBe(true);
    expect(isDeferred(anim({ trigger: "onCollision" }))).toBe(true);
    expect(isDeferred(anim({ trigger: "onEnter" }))).toBe(false);
  });

  it("skips animations whose object no longer exists, without throwing", () => {
    const s = slide([anim({ objectId: "ghost" })]);
    expect(() => harness(s, {})).not.toThrow();
    const { timeline } = harness(s, {});
    expect(timeline.duration()).toBe(0);
  });
});

describe("compileStep — an animation states its own target", () => {
  it("move travels to the destination it carries", () => {
    const s = slide([
      anim({ effect: "move", kind: "motion", params: { toX: 400, toY: 200 } }),
    ]);
    const { timeline, applied } = harness(s, { a: state({ x: 0, y: 0 }) });
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 400, y: 200 });
  });

  it("a move with no destination goes nowhere", () => {
    // It hasn't been drawn yet. Borrowing another slide's idea of where the
    // object belongs is exactly the cross-slide dependency this model removed.
    const s = slide([anim({ effect: "move" })]);
    const { timeline, applied } = harness(s, { a: state({ x: 120, y: 80 }) });
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 120, y: 80 });
  });

  it("chained moves each start where the last one left off", () => {
    // A drawn route is one move per leg, so this is the ordinary case, not an
    // exotic one: leg two has to set out from leg one's destination rather than
    // snapping back to where the slide opened.
    const s = slide([
      anim({ id: "1", effect: "move", params: { toX: 400, toY: 0 } }),
      anim({
        id: "2",
        effect: "move",
        trigger: "afterPrevious",
        params: { toX: 400, toY: 300 },
      }),
    ]);
    const { timeline, applied } = harness(s, { a: state({ x: 0, y: 0 }) });

    // Half way through the second leg it is between the two destinations —
    // which it can only be if it began at the first one.
    timeline.progress(0.75);
    expect(applied.a?.x).toBeCloseTo(400);
    expect(applied.a?.y).toBeGreaterThan(0);
    expect(applied.a?.y).toBeLessThan(300);

    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 400, y: 300 });
  });

  it("a chained move's route is walked from the previous leg's end", () => {
    // The bent case takes the same start, and takes it explicitly: the path is
    // built up-front from `origin`, so getting this wrong would teleport rather
    // than merely ease oddly.
    const s = slide([
      anim({ id: "1", effect: "move", params: { toX: 400, toY: 0 } }),
      anim({
        id: "2",
        effect: "move",
        trigger: "afterPrevious",
        // A waypoint out to the right, so the leg bulges away from a straight
        // line between the two ends.
        params: { toX: 400, toY: 400, path: [{ x: 850, y: 250 }] },
      }),
    ]);
    const { timeline, applied } = harness(s, { a: state({ x: 0, y: 0 }) });

    timeline.progress(0.75);
    // Out past both ends of the leg — it is on the drawn bulge, which starts at
    // (400, 0) plus the object's half-size, not back at the origin.
    expect(applied.a?.x).toBeGreaterThan(400);
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 400, y: 400 });
  });

  it("is mid-way at half progress (it really tweens)", () => {
    const s = slide([
      anim({ effect: "move", easing: "none", params: { toX: 100 } }),
    ]);
    const { timeline, applied } = harness(s, { a: state({ x: 0 }) });
    timeline.progress(0.5);
    expect(applied.a?.x).toBeGreaterThan(0);
    expect(applied.a?.x).toBeLessThan(100);
  });

  it("entrance fade starts hidden (via `initial`) and ends at the slide opacity", () => {
    const s = slide([anim({ kind: "entrance", effect: "fade" })]);
    const { timeline, initial, applied } = harness(s, {
      a: state({ opacity: 1 }),
    });
    // The engine snaps to `initial` before playing — that's what stops a
    // fade-in flashing at full opacity for a frame, and it's what makes the
    // object visible. The tween itself only ever writes what it animates.
    expect(initial.a).toMatchObject({ opacity: 0, visible: true });
    timeline.progress(1);
    expect(applied.a).toEqual({ opacity: 1 });
  });

  it("entrance fly starts at its origin and lands where the slide puts it", () => {
    const s = slide([
      anim({ kind: "entrance", effect: "fly", params: { toX: -200, toY: 0 } }),
    ]);
    const { timeline, initial, applied } = harness(s, {
      a: state({ x: 300, y: 100 }),
    });
    expect(initial.a).toMatchObject({ x: -200, opacity: 0 });
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 300, y: 100, opacity: 1 });
  });

  it("exit fade ends fully transparent", () => {
    const s = slide([anim({ kind: "exit", effect: "fade" })]);
    const { timeline, applied } = harness(s, { a: state() });
    timeline.progress(1);
    expect(applied.a?.opacity).toBeCloseTo(0);
  });

  it("appear shows the object; disappear hides it", () => {
    const appear = harness(
      slide([anim({ kind: "entrance", effect: "appear" })]),
      { a: state({ visible: true, opacity: 1 }) },
    );
    appear.timeline.progress(1);
    expect(appear.applied.a).toMatchObject({ visible: true, opacity: 1 });

    const disappear = harness(
      slide([anim({ kind: "exit", effect: "disappear" })]),
      { a: state() },
    );
    disappear.timeline.progress(1);
    expect(disappear.applied.a).toMatchObject({ visible: false, opacity: 0 });
  });

  it("scale grows by the factor it carries, about its centre", () => {
    const s = slide([
      anim({ kind: "motion", effect: "scale", params: { scale: 1.5 } }),
    ]);
    const { timeline, applied } = harness(s, {
      a: state({ x: 100, y: 100, w: 100, h: 100 }),
    });
    timeline.progress(1);
    // 150×150, and offset by half the growth so it swells in place.
    expect(applied.a).toMatchObject({ w: 150, h: 150, x: 75, y: 75 });
  });

  it("a scale with no factor leaves the size alone", () => {
    const s = slide([anim({ kind: "motion", effect: "scale" })]);
    const { timeline, applied } = harness(s, { a: state({ w: 100, h: 100 }) });
    timeline.progress(1);
    expect(applied.a).toMatchObject({ w: 100, h: 100 });
  });

  it("pulse returns to its original size", () => {
    const s = slide([anim({ kind: "emphasis", effect: "pulse" })]);
    const { timeline, applied } = harness(s, {
      a: state({ w: 100, h: 100 }),
    });
    timeline.progress(0.5);
    expect(applied.a!.w).toBeGreaterThan(100); // swelled
    timeline.progress(1);
    expect(applied.a).toMatchObject({ w: 100, h: 100 }); // and settled back
  });

  it("blink returns to its original opacity", () => {
    const s = slide([anim({ kind: "emphasis", effect: "blink" })]);
    const { timeline, applied } = harness(s, { a: state({ opacity: 1 }) });
    timeline.progress(0.5);
    expect(applied.a!.opacity).toBeCloseTo(0);
    timeline.progress(1);
    expect(applied.a!.opacity).toBeCloseTo(1);
  });
});

describe("compileStep — several animations on one object", () => {
  it("does not let concurrent animations clobber each other", () => {
    // A move and a fade on the same object, at the same time: each tween must
    // contribute its own property to one shared state, not overwrite the other
    // with a stale snapshot.
    const s = slide([
      anim({
        id: "1",
        objectId: "a",
        effect: "move",
        trigger: "onEnter",
        params: { toX: 400 },
      }),
      anim({
        id: "2",
        objectId: "a",
        kind: "exit",
        effect: "fade",
        trigger: "withPrevious",
      }),
    ]);
    const { timeline, applied } = harness(s, {
      a: state({ x: 0, opacity: 1 }),
    });

    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 400, opacity: 0 });
  });
});

describe("compileStep — redraw hook", () => {
  it("calls onUpdate as the timeline ticks (→ batchDraw)", () => {
    const s = slide([anim({ effect: "move", params: { toX: 100 } })]);
    const { timeline, updates } = harness(s, { a: state({ x: 0 }) });
    timeline.progress(0.5);
    expect(updates()).toBeGreaterThan(0);
  });
});

/**
 * Two timelines can drive one object at once — a slide's move and a collision's
 * disappear, say. Each must write only what it animates, or whichever ticks
 * last that frame silently undoes the other.
 */
describe("compileStep — an effect writes only what it drives", () => {
  it("a move pushes position and nothing else", () => {
    const { timeline, applied } = harness(
      slide([anim({ effect: "move", params: { toX: 100 } })]),
      { a: state({ x: 0 }) },
    );
    timeline.progress(1);
    expect(Object.keys(applied.a!).sort()).toEqual(["x", "y"]);
  });

  it("a disappear pushes visibility and nothing else", () => {
    const { timeline, applied } = harness(
      slide([anim({ kind: "exit", effect: "disappear" })]),
      { a: state() },
    );
    timeline.progress(1);
    expect(applied.a).toEqual({ visible: false, opacity: 0 });
  });

  it("a pulse leaves opacity and visibility alone", () => {
    const { timeline, applied } = harness(
      slide([anim({ kind: "emphasis", effect: "pulse" })]),
      { a: state() },
    );
    timeline.progress(1);
    expect(applied.a).not.toHaveProperty("visible");
    expect(applied.a).not.toHaveProperty("opacity");
  });
});
