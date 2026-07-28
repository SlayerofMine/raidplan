import { describe, expect, it } from "vitest";
import type { Stage } from "konva/lib/Stage";
import type { Anim, PlanObject, Slide } from "@raidplan/shared";
import { createSlideScrubber } from "../../src/anim/slideScrubber";

/**
 * Time-addressed playback (`slideScrubber`), driven the way the editor's
 * playhead drives it.
 *
 * The engine only ever talks to Konva through `findOne`/`setAttrs`, so one fake
 * node stands in for a stage and the object's position becomes an assertion.
 *
 * The property under test throughout is that **the board is a function of the
 * playhead, not of the route the playhead took to get there**: the same time
 * must produce the same frame whether it was reached going forwards, backwards,
 * or by jumping.
 */
function fakeStage(ids: string[]) {
  const nodes = new Map(
    ids.map((id) => {
      const attrs: Record<string, unknown> = {
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 1,
        visible: true,
        baseW: 40,
        baseH: 40,
      };
      return [
        id,
        {
          attrs,
          setAttrs: (a: Record<string, unknown>) => Object.assign(attrs, a),
          getAttr: (key: string) => attrs[key],
          scaleX: () => 1,
          scaleY: () => 1,
          x: () => attrs["x"] as number,
          y: () => attrs["y"] as number,
          rotation: () => 0,
          opacity: () => attrs["opacity"] as number,
          visible: () => attrs["visible"] as boolean,
          getLayer: () => ({}),
          getClientRect: () => ({
            x: attrs["x"] as number,
            y: attrs["y"] as number,
            width: 40,
            height: 40,
          }),
        },
      ] as const;
    }),
  );
  const stage = {
    findOne: (selector: string) => nodes.get(selector.replace("#", "")),
    batchDraw: () => {},
  };
  return {
    stage: stage as unknown as Stage,
    x: (id: string) => nodes.get(id)!.x(),
  };
}

const OBJECT_ID = "token";

const object: PlanObject = {
  id: OBJECT_ID,
  type: "icon",
  base: { x: 0, y: 0, w: 40, h: 40, rotation: 0, opacity: 1 },
} as unknown as PlanObject;

const leg = (id: string, toX: number, delayMs: number): Anim => ({
  id,
  objectId: OBJECT_ID,
  kind: "motion",
  effect: "move",
  trigger: "afterPrevious",
  delayMs,
  durationMs: 500,
  easing: "none",
  params: { toX, toY: 0 },
});

/**
 * The shape a drawn multi-leg move takes after the move-segment refactor: one
 * animation per leg, chained `afterPrevious`, with a pause between them.
 *
 * Leg 1: 0 → 500ms, x 0 → 100. Gap: 500 → 800ms. Leg 2: 800 → 1300ms, x 100 → 300.
 */
const GAP_START = 500;
const GAP_END = 800;
const LEG_ONE_END_X = 100;

function twoLegSlide(): Slide {
  return {
    id: "slide-1",
    name: "Slide 1",
    states: {
      [OBJECT_ID]: { x: 0, y: 0, w: 40, h: 40, rotation: 0, opacity: 1 },
    },
    animations: [
      leg("a", LEG_ONE_END_X, 0),
      leg("b", 300, GAP_END - GAP_START),
    ],
  } as unknown as Slide;
}

function scrubber() {
  const { stage, x } = fakeStage([OBJECT_ID]);
  return {
    x,
    scrub: createSlideScrubber({
      stage,
      slides: [twoLegSlide()],
      objects: { [OBJECT_ID]: object },
      objectIds: [OBJECT_ID],
    }),
  };
}

/** Somewhere inside the pause between the two legs. */
const IN_THE_GAP = 650;

describe("scrubbing a multi-leg move", () => {
  it("holds the object at the end of leg one throughout the gap, going forwards", () => {
    const { scrub, x } = scrubber();
    scrub.seek(0, 250);
    scrub.seek(0, IN_THE_GAP);
    expect(x(OBJECT_ID)).toBeCloseTo(LEG_ONE_END_X);
  });

  it("puts it in the same place arriving at the gap backwards", () => {
    const { scrub, x } = scrubber();
    // Out to the far end, then back into the pause.
    scrub.seek(0, 1300);
    scrub.seek(0, IN_THE_GAP);
    expect(x(OBJECT_ID)).toBeCloseTo(LEG_ONE_END_X);
  });

  it("holds it there when the gap is entered a step at a time, which is what dragging the playhead actually does (regression: scrubbing back into a pause snapped the object to its original start, and it stayed there until the playhead reached a moving segment again)", () => {
    const { scrub, x } = scrubber();
    scrub.seek(0, 1300);
    // Landing on leg two's first instant before stepping back into the gap is
    // the whole point: it leaves *both* legs' progress unchanged by the next
    // step — leg one still finished, leg two still not started — so a seek that
    // only redraws what has visibly moved redraws nothing at all.
    scrub.seek(0, GAP_END);
    scrub.seek(0, IN_THE_GAP);
    expect(x(OBJECT_ID)).toBeCloseTo(LEG_ONE_END_X);
  });

  it("survives a slow drag backwards across the whole slide", () => {
    const { scrub, x } = scrubber();
    scrub.seek(0, 1300);
    for (let t = 1300; t >= GAP_START; t -= 50) scrub.seek(0, t);
    // Anywhere in the pause is the end of leg one, however slowly it was reached.
    expect(x(OBJECT_ID)).toBeCloseTo(LEG_ONE_END_X);
  });

  it("agrees with itself: the gap looks the same reached from either direction", () => {
    const forwards = scrubber();
    forwards.scrub.seek(0, 250);
    forwards.scrub.seek(0, IN_THE_GAP);

    const backwards = scrubber();
    backwards.scrub.seek(0, 1300);
    backwards.scrub.seek(0, IN_THE_GAP);

    expect(backwards.x(OBJECT_ID)).toBeCloseTo(forwards.x(OBJECT_ID));
  });

  it("still rewinds properly into the first leg, which always worked", () => {
    const { scrub, x } = scrubber();
    scrub.seek(0, 1300);
    scrub.seek(0, 250);
    // Halfway through a linear leg from 0 to 100.
    expect(x(OBJECT_ID)).toBeCloseTo(LEG_ONE_END_X / 2);
  });

  it("returns to the very start when scrubbed back to zero", () => {
    const { scrub, x } = scrubber();
    scrub.seek(0, 1300);
    scrub.seek(0, 1);
    expect(x(OBJECT_ID)).toBeCloseTo(0, 0);
  });

  it("holds a *routed* leg's end through the gap too — a route compiles to progress along a path, not to an x/y tween, so it caches separately", () => {
    const { stage, x } = fakeStage([OBJECT_ID]);
    const slide = twoLegSlide();
    // Give leg one an interior waypoint, which is what drawing a corner does.
    slide.animations[0]!.params = {
      toX: LEG_ONE_END_X,
      toY: 0,
      path: [{ x: 60, y: 40 }],
    };
    const scrub = createSlideScrubber({
      stage,
      slides: [slide],
      objects: { [OBJECT_ID]: object },
      objectIds: [OBJECT_ID],
    });

    scrub.seek(0, 1300);
    scrub.seek(0, GAP_END);
    scrub.seek(0, IN_THE_GAP);
    expect(x(OBJECT_ID)).toBeCloseTo(LEG_ONE_END_X);
  });

  it("lands at the end of the journey however it got there", () => {
    const { scrub, x } = scrubber();
    scrub.seek(0, 1300);
    const forwards = x(OBJECT_ID);
    scrub.seek(0, GAP_START);
    scrub.seek(0, 1300);
    expect(x(OBJECT_ID)).toBeCloseTo(forwards);
  });
});
