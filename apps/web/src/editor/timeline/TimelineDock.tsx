import { useState } from "react";
import { BASE_STEP_INDEX, useEditorStore } from "../../store/editorStore";
import { TimelineChart } from "./TimelineChart";

/**
 * The Timeline dock (plan §3.4) — a collapsible tray under the step strip that
 * shows a Gantt chart for the **current step only**, mirroring the Animation
 * panel in the properties sidebar (both are scoped to the step you're editing).
 * Showing every step at once ate too much vertical space; switch steps in the
 * strip to move the timeline. Collapsed by default so it never steals canvas
 * space until asked for.
 */
export function TimelineDock() {
  const [open, setOpen] = useState(false);
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex);
  const stepName = useEditorStore((s) =>
    s.currentStepIndex >= 0
      ? (s.steps[s.currentStepIndex]?.name ?? `Step ${s.currentStepIndex + 1}`)
      : null,
  );

  const onStep = currentStepIndex !== BASE_STEP_INDEX && stepName !== null;

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
        {onStep && <span className="text-neutral-500">· {stepName}</span>}
      </button>

      {open &&
        (onStep ? (
          <div className="max-h-72 overflow-y-auto px-3 pb-2">
            <TimelineChart stepIndex={currentStepIndex} />
          </div>
        ) : (
          <p
            data-testid="timeline-no-step"
            className="px-3 pb-2 text-xs text-neutral-600"
          >
            Select a step to see its timeline.
          </p>
        ))}
    </div>
  );
}
