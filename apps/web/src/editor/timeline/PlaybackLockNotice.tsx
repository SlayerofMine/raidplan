import { formatMs, selectPlaybackLocked, usePlayhead } from "./playhead";

/**
 * Says why the editor has gone quiet, and offers the one thing that undoes it.
 *
 * The lock is otherwise invisible from the canvas — clicks simply stop working —
 * and "nothing happens when I drag a token" is a bug report, not a feature. So
 * the board states plainly that it is showing a moment rather than the plan, and
 * puts Stop within reach of the pointer that just tried to edit.
 */
export function PlaybackLockNotice() {
  const locked = usePlayhead(selectPlaybackLocked);
  const timeMs = usePlayhead((s) => s.timeMs);
  const isPlaying = usePlayhead((s) => s.isPlaying);
  if (!locked) return null;

  return (
    <div
      data-testid="playback-lock-notice"
      role="status"
      className="pointer-events-none absolute inset-x-0 top-2 flex justify-center"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded border border-accent/60 bg-panel/90 px-2 py-1 text-xs text-neutral-300 shadow">
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
        <span>
          {isPlaying ? "Playing" : "Paused"} at{" "}
          <span className="tabular-nums text-neutral-100">
            {formatMs(timeMs)}
          </span>{" "}
          — editing is off until you stop.
        </span>
        <button
          type="button"
          data-testid="playback-lock-stop"
          onClick={usePlayhead.getState().stop}
          className="rounded border border-panelborder px-1.5 py-0.5 hover:border-accent"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
