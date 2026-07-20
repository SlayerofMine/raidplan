import { describe, expect, it, vi } from "vitest";
import type { Anim, ObjectState, ResolvedStates, Step } from "@raidplan/shared";
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

function step(animations: Anim[]): Step {
  return { id: "s1", overrides: {}, animations };
}

/** Compile and collect the values pushed at each object. */
function harness(s: Step, start: ResolvedStates, end: ResolvedStates) {
  const applied: Record<string, Partial<ObjectState>> = {};
  const onUpdate = vi.fn();
  const { timeline, initial } = compileStep({
    step: s,
    start,
    end,
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
    const { timeline } = harness(
      step([anim()]),
      { a: state() },
      { a: state() },
    );
    expect(timeline.paused()).toBe(true);
  });

  it("an empty step compiles to a zero-length timeline", () => {
    const { timeline } = harness(step([]), {}, {});
    expect(timeline.duration()).toBe(0);
  });

  it("onEnter animations all start at t=0", () => {
    const s = step([
      anim({ id: "1", objectId: "a", trigger: "onEnter", durationMs: 500 }),
      anim({ id: "2", objectId: "b", trigger: "onEnter", durationMs: 800 }),
    ]);
    const states = { a: state(), b: state() };
    const { timeline } = harness(s, states, states);
    // Both start together, so the step lasts as long as the longest.
    expect(timeline.duration()).toBeCloseTo(0.8);
  });

  it("afterPrevious appends, so durations add up", () => {
    const s = step([
      anim({ id: "1", objectId: "a", durationMs: 500 }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "afterPrevious",
        durationMs: 500,
      }),
    ]);
    const states = { a: state(), b: state() };
    const { timeline } = harness(s, states, states);
    expect(timeline.duration()).toBeCloseTo(1);
  });

  it("withPrevious starts alongside the previous animation", () => {
    const s = step([
      anim({ id: "1", objectId: "a", durationMs: 500 }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "withPrevious",
        durationMs: 500,
      }),
    ]);
    const states = { a: state(), b: state() };
    const { timeline } = harness(s, states, states);
    expect(timeline.duration()).toBeCloseTo(0.5);
  });

  it("applies delayMs on top of the trigger position", () => {
    const s = step([anim({ durationMs: 500, delayMs: 250 })]);
    const states = { a: state() };
    const { timeline } = harness(s, states, states);
    expect(timeline.duration()).toBeCloseTo(0.75);
  });

  it("excludes deferred (click/collision) animations from the step timeline", () => {
    const states = { a: state() };
    for (const trigger of ["onClick", "onCollision"] as const) {
      const s = step([anim({ trigger, durationMs: 500 })]);
      expect(harness(s, states, states).timeline.duration()).toBe(0);
    }
    expect(isDeferred(anim({ trigger: "onClick" }))).toBe(true);
    expect(isDeferred(anim({ trigger: "onCollision" }))).toBe(true);
    expect(isDeferred(anim({ trigger: "onEnter" }))).toBe(false);
  });

  it("skips animations whose object no longer exists, without throwing", () => {
    const s = step([anim({ objectId: "ghost" })]);
    expect(() => harness(s, {}, {})).not.toThrow();
    const { timeline } = harness(s, {}, {});
    expect(timeline.duration()).toBe(0);
  });
});

describe("compileStep — effects reach their end state", () => {
  it("move tweens to the resolved end position", () => {
    const s = step([anim({ effect: "move", kind: "motion" })]);
    const { timeline, applied } = harness(
      s,
      { a: state({ x: 0, y: 0 }) },
      { a: state({ x: 400, y: 200 }) },
    );
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 400, y: 200 });
  });

  it("move honours an explicit target point over the resolved end", () => {
    const s = step([anim({ effect: "move", params: { toX: 50, toY: 60 } })]);
    const { timeline, applied } = harness(
      s,
      { a: state() },
      { a: state({ x: 400, y: 200 }) },
    );
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 50, y: 60 });
  });

  it("is mid-way at half progress (it really tweens)", () => {
    const s = step([anim({ effect: "move", easing: "none" })]);
    const { timeline, applied } = harness(
      s,
      { a: state({ x: 0 }) },
      { a: state({ x: 100 }) },
    );
    timeline.progress(0.5);
    expect(applied.a?.x).toBeGreaterThan(0);
    expect(applied.a?.x).toBeLessThan(100);
  });

  it("entrance fade starts hidden (via `initial`) and ends at the end opacity", () => {
    const s = step([anim({ kind: "entrance", effect: "fade" })]);
    const { timeline, initial, applied } = harness(
      s,
      { a: state({ opacity: 1 }) },
      { a: state({ opacity: 1 }) },
    );
    // The engine snaps to `initial` before playing — that's what stops a
    // fade-in flashing at full opacity for a frame.
    expect(initial.a).toMatchObject({ opacity: 0, visible: true });
    timeline.progress(1);
    expect(applied.a).toMatchObject({ opacity: 1, visible: true });
  });

  it("entrance fly starts at its origin and lands on the end state", () => {
    const s = step([
      anim({ kind: "entrance", effect: "fly", params: { toX: -200, toY: 0 } }),
    ]);
    const { timeline, initial, applied } = harness(
      s,
      { a: state({ x: 300, y: 100 }) },
      { a: state({ x: 300, y: 100 }) },
    );
    expect(initial.a).toMatchObject({ x: -200, opacity: 0 });
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 300, y: 100, opacity: 1 });
  });

  it("exit fade ends fully transparent", () => {
    const s = step([anim({ kind: "exit", effect: "fade" })]);
    const { timeline, applied } = harness(s, { a: state() }, { a: state() });
    timeline.progress(1);
    expect(applied.a?.opacity).toBeCloseTo(0);
  });

  it("appear shows the object; disappear hides it", () => {
    const appear = harness(
      step([anim({ kind: "entrance", effect: "appear" })]),
      { a: state({ visible: false, opacity: 0 }) },
      { a: state({ visible: true, opacity: 1 }) },
    );
    appear.timeline.progress(1);
    expect(appear.applied.a).toMatchObject({ visible: true, opacity: 1 });

    const disappear = harness(
      step([anim({ kind: "exit", effect: "disappear" })]),
      { a: state() },
      { a: state() },
    );
    disappear.timeline.progress(1);
    expect(disappear.applied.a).toMatchObject({ visible: false, opacity: 0 });
  });

  it("scale tweens to the end size", () => {
    const s = step([anim({ kind: "emphasis", effect: "scale" })]);
    const { timeline, applied } = harness(
      s,
      { a: state({ w: 100, h: 100 }) },
      { a: state({ w: 200, h: 150 }) },
    );
    timeline.progress(1);
    expect(applied.a).toMatchObject({ w: 200, h: 150 });
  });

  it("pulse returns to its original size", () => {
    const s = step([anim({ kind: "emphasis", effect: "pulse" })]);
    const { timeline, applied } = harness(
      s,
      { a: state({ w: 100, h: 100 }) },
      { a: state({ w: 100, h: 100 }) },
    );
    timeline.progress(0.5);
    expect(applied.a!.w).toBeGreaterThan(100); // swelled
    timeline.progress(1);
    expect(applied.a).toMatchObject({ w: 100, h: 100 }); // and settled back
  });

  it("blink returns to its original opacity", () => {
    const s = step([anim({ kind: "emphasis", effect: "blink" })]);
    const { timeline, applied } = harness(
      s,
      { a: state({ opacity: 1 }) },
      { a: state({ opacity: 1 }) },
    );
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
    const s = step([
      anim({ id: "1", objectId: "a", effect: "move", trigger: "onEnter" }),
      anim({
        id: "2",
        objectId: "a",
        kind: "exit",
        effect: "fade",
        trigger: "withPrevious",
      }),
    ]);
    const { timeline, applied } = harness(
      s,
      { a: state({ x: 0, opacity: 1 }) },
      { a: state({ x: 400, opacity: 1 }) },
    );

    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 400, opacity: 0 });
  });
});

describe("compileStep — redraw hook", () => {
  it("calls onUpdate as the timeline ticks (→ batchDraw)", () => {
    const s = step([anim({ effect: "move" })]);
    const { timeline, updates } = harness(
      s,
      { a: state({ x: 0 }) },
      { a: state({ x: 100 }) },
    );
    timeline.progress(0.5);
    expect(updates()).toBeGreaterThan(0);
  });
});
