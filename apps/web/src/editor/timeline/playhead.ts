import { create } from "zustand";

/**
 * The editor's **playhead** — where in the current slide the board is being
 * shown, and whether it is running (plan §3.4).
 *
 * A store of its own, for two reasons that both matter:
 *
 *  - **It is not the document.** Scrubbing must never enter undo history or the
 *    autosave, and there is no way to forget to exclude what was never in there.
 *  - **It ticks every frame.** `timeMs` changes 60 times a second while playing.
 *    Kept here, only the transport bar and the playhead marker subscribe to it;
 *    put in the editor store it would re-render the canvas every frame, which is
 *    exactly what the playback engine exists to avoid (plan §8.1).
 *
 * Nothing in here touches Konva. The hook that owns the stage
 * ({@link ./useEditorPlayhead}) watches this and drives the pixels.
 */
export interface PlayheadState {
  /** Where the playhead sits within the current slide, in ms. */
  timeMs: number;
  /** How long the current slide plays for — the scrub range. */
  durationMs: number;
  isPlaying: boolean;
  /** Rate multiplier: 1 is real time. */
  speed: number;
  /** Start over at 0 on reaching the end, instead of stopping there. */
  loop: boolean;

  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Back to the top and stop — the board returns to the state you edit. */
  stop: () => void;
  seekMs: (ms: number) => void;
  setSpeed: (speed: number) => void;
  setLoop: (loop: boolean) => void;
  /** Told by the driver when the slide (or its animations) changed length. */
  setDurationMs: (ms: number) => void;
}

/** Rates the transport offers, slowest first. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** A playhead time, in seconds to two places — short enough to read as it runs. */
export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

const clamp = (ms: number, durationMs: number) =>
  Math.max(0, Math.min(ms, durationMs));

export const usePlayhead = create<PlayheadState>()((set, get) => ({
  timeMs: 0,
  durationMs: 0,
  isPlaying: false,
  speed: 1,
  loop: false,

  play: () =>
    set((s) => {
      if (s.durationMs <= 0) return s;
      // Pressing play at the very end starts it over, rather than sitting there
      // doing nothing — the same thing every transport does.
      return {
        isPlaying: true,
        timeMs: s.timeMs >= s.durationMs ? 0 : s.timeMs,
      };
    }),

  pause: () => set({ isPlaying: false }),

  toggle: () => (get().isPlaying ? get().pause() : get().play()),

  stop: () => set({ isPlaying: false, timeMs: 0 }),

  seekMs: (ms) => set((s) => ({ timeMs: clamp(ms, s.durationMs) })),

  setSpeed: (speed) => set({ speed }),

  setLoop: (loop) => set({ loop }),

  setDurationMs: (ms) =>
    set((s) =>
      // A shortened slide must not strand the playhead past its end, or the
      // board would be locked with nothing to scrub back through.
      s.durationMs === ms ? s : { durationMs: ms, timeMs: clamp(s.timeMs, ms) },
    ),
}));

/**
 * Is the board being shown at some moment other than the one you edit?
 *
 * This — not `isPlaying` — is the editing lock. A paused playhead half way
 * through a slide is showing tweened positions that exist nowhere in the
 * document; dragging a token there would write the *animated* coordinates back
 * as its layout, silently rewriting the slide from a frame of its own animation.
 * So editing is only live at time 0, where what you see is what is stored.
 */
export const selectPlaybackLocked = (s: PlayheadState): boolean =>
  s.isPlaying || s.timeMs > 0;

/** The lock, for code outside React (event handlers, store actions). */
export const isPlaybackLocked = (): boolean =>
  selectPlaybackLocked(usePlayhead.getState());
