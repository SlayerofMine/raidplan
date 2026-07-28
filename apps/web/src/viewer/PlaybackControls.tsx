import type { ReactNode } from "react";
import {
  LuMaximize,
  LuPause,
  LuPlay,
  LuRotateCcw,
  LuSkipBack,
  LuSkipForward,
} from "react-icons/lu";
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
        icon={<LuSkipBack aria-hidden />}
        onClick={playback.previous}
        disabled={slideIndex <= 0}
      />
      <Btn
        label={isPlaying ? "Pause" : "Play"}
        icon={isPlaying ? <LuPause aria-hidden /> : <LuPlay aria-hidden />}
        onClick={playback.toggle}
        disabled={slideCount === 0}
        testId="play-toggle"
      />
      <Btn
        label="Restart slide"
        icon={<LuRotateCcw aria-hidden />}
        onClick={playback.restart}
      />
      <Btn
        label="Next slide"
        icon={<LuSkipForward aria-hidden />}
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

      <Btn
        label="Fullscreen"
        icon={<LuMaximize aria-hidden />}
        onClick={onFullscreen}
      />
    </div>
  );
}

function Btn({
  label,
  icon,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  icon: ReactNode;
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
      className="flex items-center justify-center rounded border border-panelborder px-2 py-1.5 text-sm hover:border-accent disabled:opacity-40"
    >
      {icon}
    </button>
  );
}
