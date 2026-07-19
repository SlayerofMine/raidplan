import { describe, expect, it, vi } from "vitest";
import type { Anim, Step } from "@raidplan/shared";
import {
  collisionTailMs,
  DEFAULT_HOLD_MS,
  encodePlanVideo,
  evenSize,
  planFrames,
  videoFileName,
  type Frame,
  type VideoDeps,
} from "./videoExport";

function anim(over: Partial<Anim> = {}): Anim {
  return {
    id: "a1",
    objectId: "o1",
    kind: "motion",
    effect: "move",
    trigger: "onEnter",
    delayMs: 0,
    durationMs: 1000,
    easing: "none",
    ...over,
  };
}

const step = (id: string, animations: Anim[] = []): Step => ({
  id,
  overrides: {},
  animations,
});

describe("planFrames", () => {
  it("covers a step's full playing length at the requested fps", () => {
    // 1000ms at 10fps = 100ms per frame -> 10 intervals, 11 frames (0…1000).
    const frames = planFrames([step("s", [anim({ durationMs: 1000 })])], {
      fps: 10,
    });
    expect(frames).toHaveLength(11);
    expect(frames[0]).toEqual({ stepIndex: 0, timeMs: 0 });
    expect(frames.at(-1)).toEqual({ stepIndex: 0, timeMs: 1000 });
  });

  it("ends on the settled state, so the last frame is the step's end", () => {
    // `holdMs: 0` isolates this from the minimum-hold rule below.
    const frames = planFrames([step("s", [anim({ durationMs: 500 })])], {
      fps: 20,
      holdMs: 0,
    });
    expect(frames.at(-1)!.timeMs).toBe(500);
  });

  it("holds a step that doesn't animate, rather than skipping it", () => {
    // Otherwise a static plan would export as a zero-length file.
    const frames = planFrames([step("static")], { fps: 10 });
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.at(-1)!.timeMs).toBe(DEFAULT_HOLD_MS);
    expect(frames.every((f) => f.stepIndex === 0)).toBe(true);
  });

  it("holds a step whose animation is shorter than the minimum", () => {
    const frames = planFrames([step("s", [anim({ durationMs: 100 })])], {
      fps: 10,
      holdMs: 1000,
    });
    expect(frames.at(-1)!.timeMs).toBe(1000);
  });

  it("walks every step in order, with time restarting each step", () => {
    const frames = planFrames(
      [
        step("a", [anim({ durationMs: 200 })]),
        step("b", [anim({ durationMs: 200 })]),
      ],
      { fps: 10, holdMs: 0 },
    );
    const first = frames.filter((f) => f.stepIndex === 0);
    const second = frames.filter((f) => f.stepIndex === 1);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
    // Ordered, and each step's clock starts at zero.
    expect(frames.findIndex((f) => f.stepIndex === 1)).toBe(first.length);
    expect(second[0]!.timeMs).toBe(0);
  });

  it("honours fps", () => {
    const at30 = planFrames([step("s", [anim({ durationMs: 1000 })])], {
      fps: 30,
    });
    const at60 = planFrames([step("s", [anim({ durationMs: 1000 })])], {
      fps: 60,
    });
    expect(at60.length).toBeGreaterThan(at30.length);
  });

  it("produces nothing for a plan with no steps", () => {
    expect(planFrames([])).toEqual([]);
  });

  it("leaves room for a collision that fires at the last moment", () => {
    // Without the tail, an orb hit on the final frame would never be seen to
    // disappear in the exported clip.
    const collide = anim({
      id: "hit",
      trigger: "onCollision",
      collideWith: ["tank"],
      durationMs: 400,
    });
    const withCollision = planFrames(
      [step("s", [anim({ durationMs: 1000 }), collide])],
      { fps: 10, holdMs: 0 },
    );
    expect(withCollision.at(-1)!.timeMs).toBe(1400);
  });

  it("doesn't pad for onClick, which can't fire during an export", () => {
    const frames = planFrames(
      [
        step("s", [
          anim({ durationMs: 1000 }),
          anim({ id: "c", trigger: "onClick", durationMs: 400 }),
        ]),
      ],
      { fps: 10, holdMs: 0 },
    );
    expect(frames.at(-1)!.timeMs).toBe(1000);
  });
});

describe("collisionTailMs", () => {
  it("is the longest collision animation on the step", () => {
    expect(
      collisionTailMs(
        step("s", [
          anim({ id: "a", trigger: "onCollision", durationMs: 300 }),
          anim({ id: "b", trigger: "onCollision", durationMs: 700 }),
        ]),
      ),
    ).toBe(700);
  });

  it("counts pulse/blink at their out-and-back length", () => {
    expect(
      collisionTailMs(
        step("s", [
          anim({
            trigger: "onCollision",
            kind: "emphasis",
            effect: "pulse",
            durationMs: 300,
          }),
        ]),
      ),
    ).toBe(600);
  });

  it("is zero without collision triggers", () => {
    expect(collisionTailMs(step("s", [anim()]))).toBe(0);
    expect(collisionTailMs(step("empty"))).toBe(0);
  });
});

describe("evenSize", () => {
  it("rounds down to even, because VP9 encodes 4:2:0 chroma", () => {
    expect(evenSize(1600, 900)).toEqual({ width: 1600, height: 900 });
    expect(evenSize(1601, 901)).toEqual({ width: 1600, height: 900 });
  });

  it("never returns a degenerate size", () => {
    expect(evenSize(0, 0)).toEqual({ width: 2, height: 2 });
  });
});

describe("videoFileName", () => {
  it("slugifies the plan title", () => {
    expect(videoFileName("Mythic Test Boss")).toBe("mythic-test-boss.webm");
    expect(videoFileName("   ")).toBe("plan.webm");
  });
});

/** A deps harness recording everything the encoder pipeline did. */
function harness(over: Partial<VideoDeps> = {}) {
  const encoded: { timestamp: number; keyFrame: boolean }[] = [];
  const muxed: unknown[] = [];
  const saved: { blob: Blob; filename: string }[] = [];
  const order: string[] = [];
  let handlers: {
    output: (c: unknown, m: unknown) => void;
    error: (e: Error) => void;
  } | null = null;

  const deps: VideoDeps = {
    createMuxer: () => ({
      addVideoChunk: (chunk) => muxed.push(chunk),
      finalize: () => order.push("finalize"),
      buffer: () => new ArrayBuffer(128),
    }),
    createEncoder: (h) => {
      handlers = h;
      return {
        configure: () => order.push("configure"),
        encode: (frame, options) => {
          encoded.push({
            timestamp: (frame as unknown as { timestamp: number }).timestamp,
            keyFrame: options?.keyFrame ?? false,
          });
          // Real encoders emit chunks asynchronously; emit one per frame.
          handlers?.output({ n: encoded.length }, {});
        },
        flush: async () => {
          order.push("flush");
        },
        close: () => order.push("close"),
      };
    },
    createFrame: (_canvas, timestamp) => ({ timestamp, close: vi.fn() }),
    saveBlob: (blob, filename) => saved.push({ blob, filename }),
    ...over,
  };

  return {
    deps,
    encoded,
    muxed,
    saved,
    order,
    fail: (e: Error) => handlers?.error(e),
  };
}

const canvas = {} as HTMLCanvasElement;
const frames: Frame[] = [
  { stepIndex: 0, timeMs: 0 },
  { stepIndex: 0, timeMs: 100 },
  { stepIndex: 1, timeMs: 0 },
];

describe("encodePlanVideo", () => {
  const run = (h: ReturnType<typeof harness>, over = {}) =>
    encodePlanVideo({
      frames,
      renderFrame: () => canvas,
      size: { width: 1600, height: 900 },
      filename: "plan.webm",
      deps: h.deps,
      fps: 10,
      ...over,
    });

  it("encodes every frame and saves the muxed file", async () => {
    const h = harness();
    const bytes = await run(h);
    expect(h.encoded).toHaveLength(3);
    expect(h.muxed).toHaveLength(3);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]!.filename).toBe("plan.webm");
    expect(h.saved[0]!.blob.type).toBe("video/webm");
    expect(bytes).toBe(128);
  });

  it("stamps frames on the export's own clock, not wall time", () => {
    // This is why the clip is correctly paced even on a slow machine.
    const h = harness();
    return run(h).then(() => {
      expect(h.encoded.map((e) => e.timestamp)).toEqual([0, 100_000, 200_000]);
    });
  });

  it("starts with a keyframe", async () => {
    const h = harness();
    await run(h);
    expect(h.encoded[0]!.keyFrame).toBe(true);
    expect(h.encoded[1]!.keyFrame).toBe(false);
  });

  it("configures, flushes and finalizes in that order", async () => {
    const h = harness();
    await run(h);
    expect(h.order).toEqual(["configure", "flush", "close", "finalize"]);
  });

  it("reports progress through to completion", async () => {
    const h = harness();
    const seen: number[] = [];
    await run(h, { onProgress: (f: number) => seen.push(f) });
    expect(seen.at(-1)).toBe(1);
    expect(seen[0]).toBeCloseTo(1 / 3);
  });

  it("skips frames the renderer couldn't produce", async () => {
    const h = harness();
    await encodePlanVideo({
      frames,
      renderFrame: (f) => (f.stepIndex === 1 ? null : canvas),
      size: { width: 100, height: 100 },
      filename: "p.webm",
      deps: h.deps,
    });
    expect(h.encoded).toHaveLength(2);
    expect(h.saved).toHaveLength(1); // still writes what it got
  });

  it("surfaces an encoder failure instead of saving a broken file", async () => {
    const h = harness();
    const boom = new Error("encoder died");
    await expect(
      encodePlanVideo({
        frames,
        renderFrame: () => {
          h.fail(boom);
          return canvas;
        },
        size: { width: 100, height: 100 },
        filename: "p.webm",
        deps: h.deps,
      }),
    ).rejects.toThrow("encoder died");
    expect(h.saved).toHaveLength(0);
  });

  it("rounds an odd board to even dimensions", async () => {
    const createMuxer = vi.fn(() => ({
      addVideoChunk: vi.fn(),
      finalize: vi.fn(),
      buffer: () => new ArrayBuffer(8),
    }));
    const h = harness({ createMuxer });
    await run(h, { size: { width: 1601, height: 901 } });
    expect(createMuxer).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1600, height: 900 }),
    );
  });
});
