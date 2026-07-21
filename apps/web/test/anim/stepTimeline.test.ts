import { describe, expect, it } from "vitest";
import {
  layoutStepTimeline,
  stepDurationSeconds,
  type Anim,
  type ObjectState,
  type ResolvedStates,
  type Step,
} from "@raidplan/shared";
import { compileStep } from "../../src/anim/compileStep";
import {
  dragValueMs,
  msToPx,
  nudgeValueMs,
  packLanes,
  pxToMs,
  snapMs,
  timelineScale,
} from "../../src/anim/stepTimeline";

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

/**
 * The whole point of the shared module: a Gantt bar must sit exactly where the
 * player runs it. This pins `layoutStepTimeline` to `compileStep`'s GSAP output.
 */
describe("layoutStepTimeline — matches the compiled GSAP timeline", () => {
  function state(): ObjectState {
    return {
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
    };
  }
  function durationOf(animations: Anim[]): number {
    const ids = [...new Set(animations.map((a) => a.objectId))];
    const states: ResolvedStates = Object.fromEntries(
      ids.map((id) => [id, state()]),
    );
    const step: Step = { id: "s", overrides: {}, animations };
    const { timeline } = compileStep({
      step,
      start: states,
      end: states,
      apply: () => {},
    });
    return timeline.duration();
  }

  const cases: Record<string, Anim[]> = {
    onEnter: [
      anim({ id: "1", objectId: "a", durationMs: 500 }),
      anim({ id: "2", objectId: "b", durationMs: 800 }),
    ],
    afterPrevious: [
      anim({ id: "1", objectId: "a", durationMs: 500 }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "afterPrevious",
        durationMs: 500,
      }),
    ],
    withPrevious: [
      anim({ id: "1", objectId: "a", durationMs: 500 }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "withPrevious",
        durationMs: 700,
      }),
    ],
    delayed: [anim({ delayMs: 250, durationMs: 500 })],
    pulse: [anim({ kind: "emphasis", effect: "pulse", durationMs: 400 })],
    "pulse then afterPrevious": [
      anim({
        id: "1",
        objectId: "a",
        kind: "emphasis",
        effect: "pulse",
        durationMs: 400,
      }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "afterPrevious",
        durationMs: 500,
      }),
    ],
    mixed: [
      anim({ id: "1", objectId: "a", durationMs: 300 }),
      anim({
        id: "2",
        objectId: "b",
        trigger: "withPrevious",
        durationMs: 500,
      }),
      anim({
        id: "3",
        objectId: "c",
        trigger: "afterPrevious",
        delayMs: 100,
        durationMs: 200,
      }),
    ],
  };

  for (const [name, animations] of Object.entries(cases)) {
    it(`agrees with GSAP for "${name}"`, () => {
      expect(stepDurationSeconds(animations)).toBeCloseTo(
        durationOf(animations),
      );
    });
  }
});

describe("packLanes", () => {
  it("keeps sequential spans in a single lane", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", durationMs: 500 }),
      anim({ id: "2", trigger: "afterPrevious", durationMs: 500 }),
    ]);
    const { laneCount } = packLanes(t.spans);
    expect(laneCount).toBe(1);
  });

  it("splits overlapping spans across lanes", () => {
    const t = layoutStepTimeline([
      anim({ id: "1", durationMs: 500 }),
      anim({ id: "2", trigger: "withPrevious", durationMs: 500 }),
    ]);
    const { lane, laneCount } = packLanes(t.spans);
    expect(laneCount).toBe(2);
    expect(lane.get("1")).not.toBe(lane.get("2"));
  });

  it("reports at least one lane even when empty", () => {
    expect(packLanes([]).laneCount).toBe(1);
  });
});

describe("pixel <-> millisecond helpers", () => {
  it("scales the timeline into the usable width, minus handle padding", () => {
    const { pxPerMs, contentMs } = timelineScale(1024, 2000, {
      minSpanMs: 1000,
      padRightPx: 24,
    });
    expect(contentMs).toBe(2000);
    expect(pxPerMs).toBeCloseTo((1024 - 24) / 2000);
  });

  it("never collapses below the minimum span", () => {
    expect(timelineScale(1000, 0, { minSpanMs: 1000 }).contentMs).toBe(1000);
  });

  it("yields a zero scale before the container is measured", () => {
    expect(timelineScale(0, 2000).pxPerMs).toBe(0);
    expect(pxToMs(100, 0)).toBe(0);
  });

  it("round-trips ms through px", () => {
    const { pxPerMs } = timelineScale(1024, 2000);
    expect(pxToMs(msToPx(500, pxPerMs), pxPerMs)).toBeCloseTo(500);
  });

  it("snaps to the grid", () => {
    expect(snapMs(237)).toBe(250);
    expect(snapMs(224)).toBe(200);
  });

  it("dragValueMs snaps and floors at the minimum", () => {
    const pxPerMs = 0.5; // 1ms = 0.5px
    // 260px right of a 100ms start = +520ms → 620 → snaps to 600.
    expect(dragValueMs(100, 260, pxPerMs, 0)).toBe(600);
    // Dragging far left can't go below the floor.
    expect(dragValueMs(100, -9999, pxPerMs, 0)).toBe(0);
    expect(dragValueMs(500, -9999, pxPerMs, 50)).toBe(50);
  });

  it("nudgeValueMs steps by whole grid increments and floors", () => {
    expect(nudgeValueMs(200, 1)).toBe(250);
    expect(nudgeValueMs(200, -1)).toBe(150);
    expect(nudgeValueMs(0, -1, 0)).toBe(0);
    expect(nudgeValueMs(100, -5, 50)).toBe(50);
  });
});
