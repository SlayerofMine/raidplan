import { Muxer, ArrayBufferTarget } from "webm-muxer";
import { layoutStepTimeline, occupiedMs, type Step } from "@raidplan/shared";
import { slugify } from "./planFile";

/**
 * One-click WebM export of a whole plan (plan §5.1's "nice-to-have").
 *
 * **Not a screen recording.** Each frame is rendered deterministically: the
 * step's GSAP timeline is *seeked* to an exact time, the resulting state is
 * pushed onto the Konva nodes, and the stage is captured at the plan's native
 * resolution. Every frame then carries an explicit timestamp into
 * `VideoEncoder`, so the clip's timing is exact however slowly it renders —
 * which is why this uses WebCodecs rather than `MediaRecorder`, whose frames
 * are stamped on arrival and would come out in slow motion on a slow machine.
 *
 * The WebCodecs and muxer calls are injected ({@link VideoDeps}) so the
 * orchestration is unit-testable under jsdom, which has neither.
 */

/** VP9 in an `.webm` container; VP8 is the fallback for older browsers. */
export const VP9_CODEC = "vp09.00.10.08";
export const VP8_CODEC = "vp8";

export const DEFAULT_FPS = 30;
/** Keyframe cadence — roughly every 2s, so seeking in a player stays snappy. */
export const KEYFRAME_INTERVAL = 60;
/** How long a step with no animations is held on screen, so it's watchable. */
export const DEFAULT_HOLD_MS = 800;
/** Bits per second. Generous: these are flat-colour boards, they compress well. */
export const DEFAULT_BITRATE = 6_000_000;

/** One frame of the export: which step, and how far into it. */
export interface Frame {
  stepIndex: number;
  timeMs: number;
}

export interface PlanFramesOptions {
  fps?: number;
  /** Minimum time on screen for a step, whether or not it animates. */
  holdMs?: number;
}

/**
 * Extra time a step needs beyond its own timeline so a collision that fires at
 * the very last moment still plays out on screen instead of being cut off.
 *
 * `onClick` is excluded: nobody is clicking during an export, so those never
 * fire and would only pad the clip.
 */
export function collisionTailMs(step: Step): number {
  let tail = 0;
  for (const anim of step.animations) {
    if (anim.trigger !== "onCollision") continue;
    // A one-shot drops the authored delay — the collision decided when.
    tail = Math.max(tail, occupiedMs(anim.effect, anim.durationMs));
  }
  return tail;
}

/**
 * The complete script of the export: every frame to render, in order.
 *
 * Step lengths come from {@link layoutStepTimeline}, the same source playback
 * and the Gantt use, so the video runs for exactly as long as the plan plays.
 * A step with no animations still gets `holdMs` of frames — otherwise a mostly
 * static plan would export as a zero-length file — and a step with collision
 * triggers gets {@link collisionTailMs} on the end.
 *
 * Pure, so the whole shape of an export is testable without a canvas.
 */
export function planFrames(
  steps: readonly Step[],
  { fps = DEFAULT_FPS, holdMs = DEFAULT_HOLD_MS }: PlanFramesOptions = {},
): Frame[] {
  const frameMs = 1000 / fps;
  const frames: Frame[] = [];

  steps.forEach((step, stepIndex) => {
    const playMs = layoutStepTimeline(step.animations).totalMs;
    const durationMs = Math.max(playMs, holdMs) + collisionTailMs(step);
    // `<=` so the settled end state is the last frame of every step.
    const count = Math.max(1, Math.round(durationMs / frameMs));
    for (let i = 0; i <= count; i++) {
      frames.push({ stepIndex, timeMs: Math.min(i * frameMs, durationMs) });
    }
  });

  return frames;
}

/** VP8/VP9 encode 4:2:0 chroma, so both dimensions must be even. */
export function evenSize(width: number, height: number) {
  return {
    width: Math.max(2, Math.floor(width / 2) * 2),
    height: Math.max(2, Math.floor(height / 2) * 2),
  };
}

/** File name for an export: `raid-night.webm`. */
export function videoFileName(title: string): string {
  return `${slugify(title)}.webm`;
}

/** The slice of `VideoEncoder` we use. */
export interface EncoderLike {
  configure(config: {
    codec: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
  }): void;
  encode(frame: VideoFrameLike, options?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
}

/** A frame handed to the encoder; `close()` releases it (they're not GC'd). */
export interface VideoFrameLike {
  close(): void;
}

export interface MuxerLike {
  addVideoChunk(chunk: unknown, meta?: unknown): void;
  finalize(): void;
  /** The finished file, available after `finalize()`. */
  buffer(): ArrayBuffer;
}

export interface VideoDeps {
  createMuxer(config: {
    codec: string;
    width: number;
    height: number;
    frameRate: number;
  }): MuxerLike;
  createEncoder(handlers: {
    output: (chunk: unknown, meta: unknown) => void;
    error: (error: Error) => void;
  }): EncoderLike;
  /** Wrap a rendered canvas as an encodable frame stamped at `timestampMicros`. */
  createFrame(
    canvas: HTMLCanvasElement,
    timestampMicros: number,
  ): VideoFrameLike;
  saveBlob(blob: Blob, filename: string): void;
}

export interface EncodePlanVideoParams {
  frames: readonly Frame[];
  /** Draw a frame and hand back the canvas holding it. */
  renderFrame: (frame: Frame) => HTMLCanvasElement | null;
  size: { width: number; height: number };
  filename: string;
  deps: VideoDeps;
  fps?: number;
  bitrate?: number;
  codec?: string;
  onProgress?: (fraction: number) => void;
}

/**
 * Render and encode every frame, then hand the finished file to the browser.
 * Returns the byte length written, or throws if the encoder rejects the stream.
 */
export async function encodePlanVideo({
  frames,
  renderFrame,
  size,
  filename,
  deps,
  fps = DEFAULT_FPS,
  bitrate = DEFAULT_BITRATE,
  codec = VP9_CODEC,
  onProgress,
}: EncodePlanVideoParams): Promise<number> {
  const { width, height } = evenSize(size.width, size.height);
  const muxer = deps.createMuxer({
    codec: codec === VP8_CODEC ? "V_VP8" : "V_VP9",
    width,
    height,
    frameRate: fps,
  });

  let failure: Error | null = null;
  const encoder = deps.createEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  const frameDurationMicros = 1_000_000 / fps;
  for (const [index, frame] of frames.entries()) {
    if (failure) break;
    const canvas = renderFrame(frame);
    if (!canvas) continue;
    // Timestamps are the export's own clock, not wall time: a slow render
    // still produces a correctly-paced video.
    const video = deps.createFrame(
      canvas,
      Math.round(index * frameDurationMicros),
    );
    try {
      encoder.encode(video, { keyFrame: index % KEYFRAME_INTERVAL === 0 });
    } finally {
      video.close();
    }
    onProgress?.((index + 1) / frames.length);
  }

  await encoder.flush();
  encoder.close();
  if (failure) throw failure;

  muxer.finalize();
  const buffer = muxer.buffer();
  deps.saveBlob(new Blob([buffer], { type: "video/webm" }), filename);
  onProgress?.(1);
  return buffer.byteLength;
}

/** Whether this browser can encode WebM (drives the button's state). */
export function canEncodeWebm(): boolean {
  return (
    typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
  );
}

/** The browser-backed dependencies, wired for the real app. */
export function browserVideoDeps(): VideoDeps {
  return {
    createMuxer: (config) => {
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: config,
      });
      return {
        addVideoChunk: (chunk, meta) =>
          muxer.addVideoChunk(
            chunk as EncodedVideoChunk,
            meta as EncodedVideoChunkMetadata,
          ),
        finalize: () => muxer.finalize(),
        buffer: () => muxer.target.buffer,
      };
    },
    createEncoder: ({ output, error }) =>
      new VideoEncoder({
        output: (chunk, meta) => output(chunk, meta),
        error,
      }),
    createFrame: (canvas, timestamp) => new VideoFrame(canvas, { timestamp }),
    saveBlob: (blob, filename) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },
  };
}
