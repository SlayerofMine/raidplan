import { useEffect, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { useEditorStore } from "../../store/editorStore";
import { usePlayhead } from "./playhead";
import { PlayheadTransport } from "./PlayheadTransport";
import { TimelineChart } from "./TimelineChart";

/**
 * The Timeline dock (plan §3.4) — a collapsible tray under the slide strip that
 * shows a Gantt chart for the **current slide only**, mirroring the Animation
 * panel in the properties sidebar (both are scoped to the slide you're editing).
 * Showing every slide at once ate too much vertical space; switch slides in the
 * strip to move the timeline. Collapsed by default so it never steals canvas
 * space until asked for.
 *
 * The transport sits in the header rather than in the tray, so playback is one
 * click away whether or not the chart is showing — and so Stop, the way out of
 * the editing lock, can never be hidden behind a collapsed panel.
 */
export function TimelineDock() {
  const [open, setOpen] = useState(false);
  const isPlaying = usePlayhead((s) => s.isPlaying);
  const currentSlideIndex = useEditorStore((s) => s.currentSlideIndex);
  // There is always a slide to be on, so the dock has no empty state left to
  // guard: the "Select a slide" placeholder existed only for the Base layout.
  const slideName = useEditorStore(
    (s) =>
      s.slides[s.currentSlideIndex]?.name ?? `Slide ${s.currentSlideIndex + 1}`,
  );

  // Pressing play with the tray shut is a fair request to see what's playing.
  useEffect(() => {
    if (isPlaying) setOpen(true);
  }, [isPlaying]);

  return (
    <div
      data-testid="timeline-dock"
      className="border-t border-panelborder bg-panel"
    >
      <div className="flex items-center gap-2 px-3 py-1">
        <button
          type="button"
          data-testid="timeline-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-xs text-neutral-300 hover:text-accent"
        >
          <span className="text-neutral-500">
            {open ? (
              <LuChevronDown aria-hidden />
            ) : (
              <LuChevronRight aria-hidden />
            )}
          </span>
          Timeline
          <span className="truncate text-neutral-500">· {slideName}</span>
        </button>
        <div className="ml-auto">
          <PlayheadTransport />
        </div>
      </div>

      {open && (
        <div className="max-h-72 overflow-y-auto px-3 pb-2">
          <TimelineChart slideIndex={currentSlideIndex} />
        </div>
      )}
    </div>
  );
}
