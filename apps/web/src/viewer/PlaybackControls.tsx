import type { PlaybackApi } from "../anim/usePlayback";

/**
 * The viewer's transport bar (plan §3.6): play/pause, restart, step nav,
 * scrub, and a step readout. Keyboard equivalents live in `ViewerPage`.
 */
export function PlaybackControls({
  playback,
  onFullscreen,
  stepName,
  recording,
}: {
  playback: PlaybackApi;
  onFullscreen: () => void;
  stepName: string;
  /** WebM recording state, when the browser supports it (plan §5.1). */
  recording?: {
    isRecording: boolean;
    supported: boolean;
    toggle: () => void;
  };
}) {
  const { stepIndex, stepCount, isPlaying, progress } = playback;

  return (
    <div className="flex items-center gap-2 border-t border-panelborder bg-panel px-3 py-2">
      <Btn
        label="Previous step"
        glyph="⏮"
        onClick={playback.previous}
        disabled={stepIndex <= 0}
      />
      <Btn
        label={isPlaying ? "Pause" : "Play"}
        glyph={isPlaying ? "⏸" : "▶"}
        onClick={playback.toggle}
        disabled={stepCount === 0}
        testId="play-toggle"
      />
      <Btn label="Restart step" glyph="↺" onClick={playback.restart} />
      <Btn
        label="Next step"
        glyph="⏭"
        onClick={playback.next}
        disabled={stepIndex >= stepCount - 1}
      />

      <span
        className="whitespace-nowrap text-sm text-neutral-400"
        data-testid="viewer-step"
      >
        {stepCount === 0 ? "No steps" : `${stepIndex + 1} / ${stepCount}`}
        <span className="ml-2 text-neutral-500">{stepName}</span>
      </span>

      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        aria-label="Scrub step"
        data-testid="scrub"
        onChange={(e) => playback.seek(Number(e.target.value))}
        className="mx-2 flex-1 accent-accent"
      />

      {recording && (
        <button
          type="button"
          aria-label={
            recording.isRecording ? "Stop recording" : "Record WebM video"
          }
          aria-pressed={recording.isRecording}
          title={
            recording.supported
              ? recording.isRecording
                ? "Stop and save the clip"
                : "Record the board to a WebM video"
              : "This browser can't record WebM video"
          }
          onClick={recording.toggle}
          disabled={!recording.supported || stepCount === 0}
          data-testid="record-toggle"
          className={`rounded border px-2 py-1 text-sm disabled:opacity-40 ${
            recording.isRecording
              ? "border-red-500 text-red-400"
              : "border-panelborder hover:border-accent"
          }`}
        >
          {recording.isRecording ? "■" : "●"}
        </button>
      )}

      <Btn label="Fullscreen" glyph="⛶" onClick={onFullscreen} />
    </div>
  );
}

function Btn({
  label,
  glyph,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent disabled:opacity-40"
    >
      {glyph}
    </button>
  );
}
