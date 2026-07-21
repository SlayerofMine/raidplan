import { describe, expect, it } from "vitest";
import {
  layoutStepTimeline,
  occupiedMs,
  stepDurationSeconds,
} from "../src/timeline.js";
import type { Anim } from "../src/plan.js";

/**
 * The trigger rules, tested with no player attached. The web suite's
 * `stepTimeline.test.ts` pins the same function against real GSAP output — this
 * one pins the rules themselves.
 */
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

const byId = (t: ReturnType<typeof layoutStepTimeline>, id: string) =>
  t.spans.find((s) => s.animId === id)!;

describe("layoutStepTimeline — trigger chaining", () => {
  it("onEnter animations all start at 0; total is the longest", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", durationMs: 500 }),
      anim({ id: "2", trigger: "onEnter", durationMs: 800 }),
    ]);
    expect(byId(t, "1").startMs).toBe(0);
    expect(byId(t, "2").startMs).toBe(0);
    expect(t.totalMs).toBe(800);
  });

  it("afterPrevious starts when the previous span ends", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", durationMs: 500 }),
      anim({ id: "2", trigger: "afterPrevious", durationMs: 500 }),
    ]);
    expect(byId(t, "2").startMs).toBe(500);
    expect(t.totalMs).toBe(1000);
  });

  it("withPrevious starts alongside the previous span", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", durationMs: 500 }),
      anim({ id: "2", trigger: "withPrevious", durationMs: 300 }),
    ]);
    expect(byId(t, "2").startMs).toBe(0);
    expect(t.totalMs).toBe(500);
  });

  it("stacks delayMs on top of the trigger anchor", () => {
    const t = layoutStepTimeline([anim({ delayMs: 250, durationMs: 500 })]);
    const s = byId(t, "anim_1");
    expect(s.triggerMs).toBe(0);
    expect(s.startMs).toBe(250);
    expect(s.endMs).toBe(750);
    expect(t.totalMs).toBe(750);
  });

  it("is empty for a step with no animations", () => {
    expect(layoutStepTimeline([])).toEqual({ spans: [], totalMs: 0 });
    expect(stepDurationSeconds([])).toBe(0);
  });

  it("reports the length in seconds", () => {
    expect(stepDurationSeconds([anim({ durationMs: 1500 })])).toBe(1.5);
  });

  it("draws a pulse bar at its real length but reserves the out-and-back", () => {
    // The reservation (what the chain anchors against) is 2×...
    expect(occupiedMs("pulse", 400)).toBe(800);
    expect(occupiedMs("blink", 400)).toBe(800);
    expect(occupiedMs("move", 400)).toBe(400);
    // ...but the bar's visual length is the real 1× tween.
    const t = layoutStepTimeline([
      anim({ kind: "emphasis", effect: "pulse", durationMs: 400 }),
    ]);
    expect(byId(t, "anim_1").spanMs).toBe(400);
    expect(t.totalMs).toBe(400);
  });

  it("shows a trailing gap: an afterPrevious bar follows the reservation", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", kind: "emphasis", effect: "pulse", durationMs: 400 }),
      anim({ id: "2", trigger: "afterPrevious", durationMs: 500 }),
    ]);
    // #1's bar ends at 400, but #2 anchors at the 800ms reservation — the gap
    // playback leaves is shown, not hidden.
    expect(byId(t, "1").endMs).toBe(400);
    expect(byId(t, "2").startMs).toBe(800);
    expect(t.totalMs).toBe(1300);
  });
});

describe("layoutStepTimeline — deferred triggers", () => {
  it("flags onCollision as deferred, like onClick", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", durationMs: 500 }),
      anim({ id: "2", trigger: "onCollision", durationMs: 300 }),
      anim({ id: "3", trigger: "afterPrevious", durationMs: 500 }),
    ]);
    expect(byId(t, "2").deferred).toBe(true);
    // A collision animation fires on contact, so it neither takes a slot in the
    // chain (#3 still follows #1) nor extends the step.
    expect(byId(t, "3").startMs).toBe(500);
    expect(t.totalMs).toBe(1000);
  });

  it("returns onClick spans flagged but out of the chain and total", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", durationMs: 500 }),
      anim({ id: "2", trigger: "onClick", durationMs: 300 }),
      anim({ id: "3", trigger: "afterPrevious", durationMs: 500 }),
    ]);
    expect(byId(t, "2").deferred).toBe(true);
    // The click span does not advance the chain: #3 follows #1, not #2.
    expect(byId(t, "3").startMs).toBe(500);
    // ...and it doesn't extend the auto-playing length.
    expect(t.totalMs).toBe(1000);
  });
});
