import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { TimelineChart } from "./TimelineChart";

/**
 * The Timeline dock (plan §3.4) — a collapsible tray under the slide strip that
 * shows a Gantt chart for the **current slide only**, mirroring the Animation
 * panel in the properties sidebar (both are scoped to the slide you're editing).
 * Showing every slide at once ate too much vertical space; switch slides in the
 * strip to move the timeline. Collapsed by default so it never steals canvas
 * space until asked for.
 */
export function TimelineDock() {
  const [open, setOpen] = useState(false);
  const currentSlideIndex = useEditorStore((s) => s.currentSlideIndex);
  // There is always a slide to be on, so the dock has no empty state left to
  // guard: the "Select a slide" placeholder existed only for the Base layout.
  const slideName = useEditorStore(
    (s) =>
      s.slides[s.currentSlideIndex]?.name ?? `Slide ${s.currentSlideIndex + 1}`,
  );

  return (
    <div
      data-testid="timeline-dock"
      className="border-t border-panelborder bg-panel"
    >
      <button
        type="button"
        data-testid="timeline-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1 text-xs text-neutral-300 hover:text-accent"
      >
        <span aria-hidden="true" className="text-neutral-500">
          {open ? "▾" : "▸"}
        </span>
        Timeline
        <span className="text-neutral-500">· {slideName}</span>
      </button>

      {open && (
        <div className="max-h-72 overflow-y-auto px-3 pb-2">
          <TimelineChart slideIndex={currentSlideIndex} />
        </div>
      )}
    </div>
  );
}
