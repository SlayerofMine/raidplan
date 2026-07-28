import { formatMs, SPEEDS, usePlayhead } from "./playhead";

/**
 * The Timeline's transport (plan §3.4): play/pause, stop, loop, speed and a
 * time readout, in the dock's header so it stays reachable with the chart
 * collapsed.
 *
 * Deliberately mirrors a video editor's: **Stop** is not Pause — it returns the
 * playhead to 0, which is the only place the plan is editable again, so it
 * doubles as "give me the board back".
 */
export function PlayheadTransport() {
  const timeMs = usePlayhead((s) => s.timeMs);
  const durationMs = usePlayhead((s) => s.durationMs);
  const isPlaying = usePlayhead((s) => s.isPlaying);
  const speed = usePlayhead((s) => s.speed);
  const loop = usePlayhead((s) => s.loop);
  const empty = durationMs <= 0;

  return (
    <div
      data-testid="playhead-transport"
      className="flex items-center gap-1"
      // The dock header is a button; these are its siblings, not its children.
      onClick={(e) => e.stopPropagation()}
    >
      <Btn
        label={isPlaying ? "Pause" : "Play"}
        glyph={isPlaying ? "⏸" : "▶"}
        testId="playhead-play"
        disabled={empty}
        onClick={usePlayhead.getState().toggle}
      />
      <Btn
        label="Stop"
        glyph="⏹"
        testId="playhead-stop"
        title="Back to the start — the plan is only editable there"
        disabled={timeMs === 0 && !isPlaying}
        onClick={usePlayhead.getState().stop}
      />
      <Btn
        label="Loop"
        glyph="⟲"
        testId="playhead-loop"
        pressed={loop}
        onClick={() => usePlayhead.getState().setLoop(!loop)}
      />

      <select
        aria-label="Playback speed"
        data-testid="playhead-speed"
        value={speed}
        onChange={(e) =>
          usePlayhead.getState().setSpeed(Number(e.target.value))
        }
        className="rounded border border-panelborder bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-300"
      >
        {SPEEDS.map((rate) => (
          <option key={rate} value={rate}>
            {rate}×
          </option>
        ))}
      </select>

      <span
        data-testid="playhead-time"
        className="w-24 text-right text-[10px] tabular-nums text-neutral-500"
      >
        {formatMs(timeMs)} / {formatMs(durationMs)}
      </span>
    </div>
  );
}

function Btn({
  label,
  glyph,
  onClick,
  disabled,
  pressed,
  testId,
  title,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
  /** Set for toggles, so the state is announced rather than only coloured. */
  pressed?: boolean;
  testId: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`rounded border px-1.5 py-0.5 text-[11px] leading-none disabled:opacity-30 ${
        pressed
          ? "border-accent text-accent"
          : "border-panelborder text-neutral-300 hover:border-accent"
      }`}
    >
      {glyph}
    </button>
  );
}
