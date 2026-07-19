import { slugify } from "../editor/planFile";

/**
 * Animated WebM export of the viewer (plan §5.1's "nice-to-have").
 *
 * PNG export re-renders the plan at native resolution; video can't work that
 * way, so this records **what is actually on screen**: an offscreen canvas is
 * composited from the stage's layers every frame and handed to `MediaRecorder`
 * through `captureStream`. Konva draws each layer to its own `<canvas>`, so
 * capturing a single layer would silently lose the map — the compositing step
 * is the whole trick.
 *
 * Every browser API it touches is injected ({@link RecorderDeps}), so the
 * lifecycle is unit-testable under jsdom, which has neither a 2D canvas nor
 * `MediaRecorder`.
 */

/** Codecs to try, best first. Safari supports none of them — see `pickWebmMimeType`. */
export const WEBM_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/** Frames per second requested from `captureStream`. */
export const DEFAULT_FPS = 30;
/** Safety net so a forgotten recording can't grow without bound. */
export const MAX_DURATION_MS = 60_000;
/** Painted under every frame, so the clip isn't transparent where the map isn't. */
export const BACKDROP = "#0b0d12";

/** The slice of Konva's `Stage` we use — narrowed so tests can pass a fake. */
export interface RecordableStage {
  width(): number;
  height(): number;
  getLayers(): readonly RecordableLayer[];
}
export interface RecordableLayer {
  /** Konva's public accessor for the layer's backing `<canvas>`. */
  getNativeCanvasElement(): HTMLCanvasElement;
}

/** The slice of `MediaRecorder` we use. */
export interface RecorderLike {
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

export interface RecorderDeps {
  createCanvas(): HTMLCanvasElement;
  isTypeSupported(mimeType: string): boolean;
  createRecorder(
    canvas: HTMLCanvasElement,
    mimeType: string,
    fps: number,
  ): RecorderLike;
  schedule(callback: () => void): number;
  cancel(handle: number): void;
  saveBlob(blob: Blob, filename: string): void;
  now(): number;
}

/**
 * The best WebM codec this browser can record, or `null` if it can't record
 * WebM at all (Safari, notably — it offers MP4 instead).
 */
export function pickWebmMimeType(
  isSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = WEBM_MIME_CANDIDATES,
): string | null {
  return candidates.find((type) => isSupported(type)) ?? null;
}

/** File name for a recording: `raid-night.webm`. */
export function recordingFileName(title: string): string {
  return `${slugify(title)}.webm`;
}

/**
 * The recording's pixel size: the layers' own backing-store size, so the clip
 * is as crisp as the screen (Konva already accounts for device pixel ratio).
 * Falls back to the stage's logical size if a layer hasn't been sized yet.
 */
export function frameSize(stage: RecordableStage): {
  width: number;
  height: number;
} {
  const first = stage.getLayers()[0]?.getNativeCanvasElement();
  if (first && first.width > 0 && first.height > 0) {
    return { width: first.width, height: first.height };
  }
  return {
    width: Math.max(1, Math.round(stage.width())),
    height: Math.max(1, Math.round(stage.height())),
  };
}

/** Flatten the stage's layers onto one context, bottom layer first. */
export function compositeStage(
  stage: RecordableStage,
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  backdrop = BACKDROP,
): void {
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, size.width, size.height);
  for (const layer of stage.getLayers()) {
    const canvas = layer.getNativeCanvasElement();
    if (canvas.width > 0 && canvas.height > 0) {
      ctx.drawImage(canvas, 0, 0, size.width, size.height);
    }
  }
}

export interface RecordingHandle {
  stop(): void;
}

export interface StartRecordingParams {
  stage: RecordableStage;
  filename: string;
  deps: RecorderDeps;
  fps?: number;
  maxDurationMs?: number;
  /** Called once the file has been handed to the browser. */
  onSaved?: (filename: string) => void;
  /** Called instead of recording when the browser can't, or on failure. */
  onError?: (message: string) => void;
}

/**
 * Begin recording the stage. Returns a handle to stop it, or `null` if the
 * browser can't record WebM — in which case `onError` has already been told
 * why, so the caller only has to react to the `null`.
 */
export function startStageRecording({
  stage,
  filename,
  deps,
  fps = DEFAULT_FPS,
  maxDurationMs = MAX_DURATION_MS,
  onSaved,
  onError,
}: StartRecordingParams): RecordingHandle | null {
  const mimeType = pickWebmMimeType(deps.isTypeSupported);
  if (!mimeType) {
    onError?.("This browser can't record WebM video.");
    return null;
  }

  const size = frameSize(stage);
  const canvas = deps.createCanvas();
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    onError?.("Couldn't open a canvas to record into.");
    return null;
  }

  let recorder: RecorderLike;
  try {
    recorder = deps.createRecorder(canvas, mimeType, fps);
  } catch {
    onError?.("This browser refused to start a recording.");
    return null;
  }

  const chunks: Blob[] = [];
  let frame: number | null = null;
  let stopped = false;
  const startedAt = deps.now();

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    deps.saveBlob(new Blob(chunks, { type: mimeType }), filename);
    onSaved?.(filename);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame !== null) deps.cancel(frame);
    frame = null;
    recorder.stop();
  };

  const tick = () => {
    if (stopped) return;
    compositeStage(stage, ctx, size);
    // Don't let a forgotten recording run away.
    if (deps.now() - startedAt >= maxDurationMs) {
      stop();
      return;
    }
    frame = deps.schedule(tick);
  };

  recorder.start();
  tick();

  return { stop };
}

/** The browser-backed dependencies, wired for the real app. */
export function browserRecorderDeps(): RecorderDeps {
  return {
    createCanvas: () => document.createElement("canvas"),
    isTypeSupported: (mimeType) =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(mimeType),
    // Adapted rather than returned raw: `MediaRecorder`'s handlers take a full
    // `BlobEvent`, and keeping that out of the seam is what lets the tests run
    // under jsdom with plain objects.
    createRecorder: (canvas, mimeType, fps) => {
      const media = new MediaRecorder(canvas.captureStream(fps), { mimeType });
      const adapter: RecorderLike = {
        ondataavailable: null,
        onstop: null,
        start: (timesliceMs) => media.start(timesliceMs),
        stop: () => media.stop(),
      };
      media.ondataavailable = (event) =>
        adapter.ondataavailable?.({ data: event.data });
      media.onstop = () => adapter.onstop?.();
      return adapter;
    },
    schedule: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
    saveBlob: (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },
    now: () => Date.now(),
  };
}

/** Whether this browser can record WebM at all (drives the button's state). */
export function canRecordWebm(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    pickWebmMimeType((type) => MediaRecorder.isTypeSupported(type)) !== null
  );
}
