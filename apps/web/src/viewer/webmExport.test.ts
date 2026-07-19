import { describe, expect, it, vi } from "vitest";
import {
  compositeStage,
  frameSize,
  pickWebmMimeType,
  recordingFileName,
  startStageRecording,
  WEBM_MIME_CANDIDATES,
  type RecordableStage,
  type RecorderDeps,
  type RecorderLike,
} from "./webmExport";

/** A stage whose layers are canvases of a fixed backing size. */
function fakeStage(
  layers: { width: number; height: number }[],
  logical = { width: 800, height: 450 },
): RecordableStage {
  return {
    width: () => logical.width,
    height: () => logical.height,
    getLayers: () =>
      layers.map((l) => ({
        getNativeCanvasElement: () => l as unknown as HTMLCanvasElement,
      })),
  };
}

/** A recorder + deps harness that records what the module did. */
function harness(over: Partial<RecorderDeps> = {}) {
  const chunks: Blob[] = [];
  const saved: { blob: Blob; filename: string }[] = [];
  let frames = 0;
  let clock = 0;

  const recorder: RecorderLike & { started: boolean; stopped: boolean } = {
    started: false,
    stopped: false,
    ondataavailable: null,
    onstop: null,
    start() {
      this.started = true;
    },
    stop() {
      this.stopped = true;
      // Mirror the browser: flush data, then fire onstop.
      for (const c of chunks) this.ondataavailable?.({ data: c });
      this.onstop?.();
    },
  };

  const ctx = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;

  const scheduled: (() => void)[] = [];
  const deps: RecorderDeps = {
    createCanvas: () => canvas,
    isTypeSupported: () => true,
    createRecorder: () => recorder,
    schedule: (cb) => {
      scheduled.push(cb);
      return ++frames;
    },
    cancel: vi.fn(),
    saveBlob: (blob, filename) => saved.push({ blob, filename }),
    now: () => clock,
    ...over,
  };

  return {
    deps,
    recorder,
    canvas,
    ctx,
    saved,
    chunks,
    /** Run the next queued animation frame. */
    tick: () => scheduled.shift()?.(),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("pickWebmMimeType", () => {
  it("prefers vp9, then vp8, then plain webm", () => {
    expect(pickWebmMimeType(() => true)).toBe("video/webm;codecs=vp9");
    expect(pickWebmMimeType((t) => t !== "video/webm;codecs=vp9")).toBe(
      "video/webm;codecs=vp8",
    );
    expect(pickWebmMimeType((t) => t === "video/webm")).toBe("video/webm");
  });

  it("returns null when the browser records no WebM at all (e.g. Safari)", () => {
    expect(pickWebmMimeType(() => false)).toBeNull();
  });

  it("offers only WebM types", () => {
    for (const type of WEBM_MIME_CANDIDATES) {
      expect(type.startsWith("video/webm")).toBe(true);
    }
  });
});

describe("recordingFileName", () => {
  it("slugifies the plan title", () => {
    expect(recordingFileName("Mythic Test Boss")).toBe("mythic-test-boss.webm");
    expect(recordingFileName("  ")).toBe("plan.webm");
  });
});

describe("frameSize", () => {
  it("uses the layers' backing-store size, so the clip matches the screen", () => {
    // Konva sizes layer canvases by device pixel ratio — 2x here.
    const stage = fakeStage([{ width: 1600, height: 900 }], {
      width: 800,
      height: 450,
    });
    expect(frameSize(stage)).toEqual({ width: 1600, height: 900 });
  });

  it("falls back to the stage size before layers are sized", () => {
    const stage = fakeStage([{ width: 0, height: 0 }], {
      width: 640,
      height: 360,
    });
    expect(frameSize(stage)).toEqual({ width: 640, height: 360 });
  });

  it("never returns a zero-sized frame", () => {
    const stage = fakeStage([], { width: 0, height: 0 });
    expect(frameSize(stage)).toEqual({ width: 1, height: 1 });
  });
});

describe("compositeStage", () => {
  it("flattens every layer, bottom first, over a backdrop", () => {
    // The whole point: Konva puts each layer on its own canvas, so recording
    // one would lose the map.
    const stage = fakeStage([
      { width: 100, height: 50 },
      { width: 100, height: 50 },
    ]);
    const ctx = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    compositeStage(stage, ctx, { width: 100, height: 50 });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it("skips layers that have no backing store yet", () => {
    const stage = fakeStage([{ width: 0, height: 0 }]);
    const ctx = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    compositeStage(stage, ctx, { width: 10, height: 10 });
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});

describe("startStageRecording", () => {
  const stage = fakeStage([{ width: 320, height: 180 }]);

  it("records, then saves the assembled clip on stop", () => {
    const h = harness();
    h.chunks.push(new Blob(["a"]), new Blob(["b"]));

    const handle = startStageRecording({
      stage,
      filename: "demo.webm",
      deps: h.deps,
    });
    expect(handle).not.toBeNull();
    expect(h.recorder.started).toBe(true);
    // Sized to the layer's backing store.
    expect(h.canvas.width).toBe(320);
    expect(h.canvas.height).toBe(180);

    handle!.stop();
    expect(h.recorder.stopped).toBe(true);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]!.filename).toBe("demo.webm");
    expect(h.saved[0]!.blob.type).toBe("video/webm;codecs=vp9");
  });

  it("composites a frame per animation frame", () => {
    const h = harness();
    startStageRecording({ stage, filename: "d.webm", deps: h.deps });
    // The first frame is drawn synchronously on start.
    expect(h.ctx.drawImage).toHaveBeenCalledTimes(1);
    h.tick();
    expect(h.ctx.drawImage).toHaveBeenCalledTimes(2);
  });

  it("stops itself once the safety limit is reached", () => {
    const h = harness();
    startStageRecording({
      stage,
      filename: "d.webm",
      deps: h.deps,
      maxDurationMs: 1000,
    });
    h.advance(1500);
    h.tick();
    expect(h.recorder.stopped).toBe(true);
    expect(h.saved).toHaveLength(1);
  });

  it("is safe to stop twice", () => {
    const h = harness();
    const handle = startStageRecording({
      stage,
      filename: "d.webm",
      deps: h.deps,
    });
    handle!.stop();
    handle!.stop();
    expect(h.saved).toHaveLength(1); // not saved again
  });

  it("refuses, with a reason, when the browser can't record WebM", () => {
    const onError = vi.fn();
    const h = harness({ isTypeSupported: () => false });
    const handle = startStageRecording({
      stage,
      filename: "d.webm",
      deps: h.deps,
      onError,
    });
    expect(handle).toBeNull();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("can't record WebM"),
    );
    expect(h.recorder.started).toBe(false);
  });

  it("reports a recorder that refuses to start, rather than throwing", () => {
    const onError = vi.fn();
    const h = harness({
      createRecorder: () => {
        throw new Error("NotSupportedError");
      },
    });
    expect(() =>
      startStageRecording({
        stage,
        filename: "d.webm",
        deps: h.deps,
        onError,
      }),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("refused"));
  });

  it("reports a canvas it can't draw into", () => {
    const onError = vi.fn();
    const h = harness({
      createCanvas: () =>
        ({ getContext: () => null }) as unknown as HTMLCanvasElement,
    });
    const handle = startStageRecording({
      stage,
      filename: "d.webm",
      deps: h.deps,
      onError,
    });
    expect(handle).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("canvas"));
  });
});
