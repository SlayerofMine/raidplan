import type { PlaybackApi } from "../anim/usePlayback";

/**
 * The viewer's transport bar (plan §3.6): play/pause, restart, slide nav,
 * scrub, and a slide readout. Keyboard equivalents live in `ViewerPage`.
 */
export function PlaybackControls({
  playback,
  onFullscreen,
  slideName,
}: {
  playback: PlaybackApi;
  onFullscreen: () => void;
  slideName: string;
}) {
  const { slideIndex, slideCount, isPlaying, progress } = playback;

  return (
    <div className="flex items-center gap-2 border-t border-panelborder bg-panel px-3 py-2">
      <Btn
        label="Previous slide"
        glyph="⏮"
        onClick={playback.previous}
        disabled={slideIndex <= 0}
      />
      <Btn
        label={isPlaying ? "Pause" : "Play"}
        glyph={isPlaying ? "⏸" : "▶"}
        onClick={playback.toggle}
        disabled={slideCount === 0}
        testId="play-toggle"
      />
      <Btn label="Restart slide" glyph="↺" onClick={playback.restart} />
      <Btn
        label="Next slide"
        glyph="⏭"
        onClick={playback.next}
        disabled={slideIndex >= slideCount - 1}
      />

      <span
        className="whitespace-nowrap text-sm text-neutral-400"
        data-testid="viewer-slide"
      >
        {`${slideIndex + 1} / ${slideCount}`}
        <span className="ml-2 text-neutral-500">{slideName}</span>
      </span>

      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={progress}
        aria-label="Scrub slide"
        data-testid="scrub"
        onChange={(e) => playback.seek(Number(e.target.value))}
        className="mx-2 flex-1 accent-accent"
      />

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
