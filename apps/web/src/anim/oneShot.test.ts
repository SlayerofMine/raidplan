import { describe, expect, it } from "vitest";
import type { Anim, ObjectState, Step } from "@raidplan/shared";
import { compileOneShot, deferredAnimsFor } from "./oneShot";

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
    trigger: "onCollision",
    collideWith: ["b"],
    delayMs: 0,
    durationMs: 500,
    easing: "none",
    ...over,
  };
}

const step = (animations: Anim[]): Step => ({
  id: "s1",
  overrides: {},
  animations,
});

function harness(a: Anim, start: ObjectState, end: ObjectState) {
  const applied: Record<string, Partial<ObjectState>> = {};
  const { timeline } = compileOneShot({
    anim: a,
    step: step([a]),
    start: { a: start },
    end: { a: end },
    apply: (id, props) => {
      applied[id] = { ...applied[id], ...props };
    },
  });
  return { timeline, applied };
}

describe("compileOneShot", () => {
  it("plays a deferred animation despite its trigger", () => {
    // The trigger already fired — the compiled timeline must actually run.
    const { timeline, applied } = harness(
      anim({ trigger: "onCollision" }),
      state({ x: 0 }),
      state({ x: 400 }),
    );
    expect(timeline.duration()).toBeCloseTo(0.5);
    timeline.progress(1);
    expect(applied.a).toMatchObject({ x: 400 });
  });

  it("ignores the authored delay — the trigger decided when it starts", () => {
    const { timeline } = harness(
      anim({ delayMs: 2000, durationMs: 500 }),
      state(),
      state(),
    );
    expect(timeline.duration()).toBeCloseTo(0.5);
  });

  it("starts from the state it's given, not the step's start", () => {
    // Playback passes the object's *live* position so a triggered animation
    // continues from where the object actually is.
    const { timeline, applied } = harness(
      anim({ effect: "move" }),
      state({ x: 250 }),
      state({ x: 300 }),
    );
    timeline.progress(0.5);
    expect(applied.a!.x).toBeGreaterThan(250);
    expect(applied.a!.x).toBeLessThan(300);
  });

  it("runs an exit effect to its end", () => {
    const { timeline, applied } = harness(
      anim({ kind: "exit", effect: "disappear" }),
      state(),
      state(),
    );
    timeline.progress(1);
    expect(applied.a).toMatchObject({ visible: false, opacity: 0 });
  });
});

describe("deferredAnimsFor", () => {
  const s = step([
    anim({ id: "1", objectId: "a", trigger: "onClick" }),
    anim({ id: "2", objectId: "a", trigger: "onCollision" }),
    anim({ id: "3", objectId: "b", trigger: "onClick" }),
    anim({ id: "4", objectId: "a", trigger: "onEnter" }),
  ]);

  it("filters by object and trigger", () => {
    expect(deferredAnimsFor(s, "a", "onClick").map((a) => a.id)).toEqual(["1"]);
    expect(deferredAnimsFor(s, "a", "onCollision").map((a) => a.id)).toEqual([
      "2",
    ]);
  });

  it("is empty for an unknown object or a missing step", () => {
    expect(deferredAnimsFor(s, "ghost", "onClick")).toEqual([]);
    expect(deferredAnimsFor(undefined, "a", "onClick")).toEqual([]);
  });
});
