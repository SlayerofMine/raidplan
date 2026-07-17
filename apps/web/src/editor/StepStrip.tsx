import { BASE_STEP_INDEX, useEditorStore } from "../store/editorStore";

/**
 * The steps strip (plan §3.2) — the plan's "slides".
 *
 * `Base` is the starting layout: edits there land on each object's `base`.
 * Selecting a step means edits land in *that step's* overrides, which is what
 * makes "the editor edits the end state" true (plan §5). Without an explicit
 * Base entry you could never reposition the opening layout without inventing
 * an animation.
 */
export function StepStrip() {
  const steps = useEditorStore((s) => s.steps);
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex);
  const selectStep = useEditorStore((s) => s.selectStep);
  const addStep = useEditorStore((s) => s.addStep);
  const duplicateStep = useEditorStore((s) => s.duplicateStep);
  const deleteStep = useEditorStore((s) => s.deleteStep);
  const moveStep = useEditorStore((s) => s.moveStep);

  const isBase = currentStepIndex === BASE_STEP_INDEX;

  return (
    <footer
      aria-label="Steps"
      className="flex items-center gap-2 overflow-x-auto border-t border-panelborder bg-panel px-3 py-2"
    >
      <button
        type="button"
        onClick={() => selectStep(BASE_STEP_INDEX)}
        aria-pressed={isBase}
        data-testid="step-base"
        className={chip(isBase)}
      >
        Base
      </button>

      <span className="text-neutral-600">›</span>

      {steps.map((step, index) => {
        const active = index === currentStepIndex;
        return (
          <div
            key={step.id}
            className={`flex items-center gap-1 rounded border px-1 ${
              active ? "border-accent" : "border-panelborder"
            }`}
          >
            <button
              type="button"
              onClick={() => selectStep(index)}
              aria-pressed={active}
              data-testid={`step-${index}`}
              className={chip(active)}
            >
              {step.name ?? `Step ${index + 1}`}
              {step.animations.length > 0 && (
                <span className="ml-1 text-xs text-neutral-500">
                  ({step.animations.length})
                </span>
              )}
            </button>
            <IconBtn
              label={`Move ${step.name ?? `Step ${index + 1}`} earlier`}
              glyph="◀"
              disabled={index === 0}
              onClick={() => moveStep(index, index - 1)}
            />
            <IconBtn
              label={`Move ${step.name ?? `Step ${index + 1}`} later`}
              glyph="▶"
              disabled={index === steps.length - 1}
              onClick={() => moveStep(index, index + 1)}
            />
            <IconBtn
              label={`Duplicate ${step.name ?? `Step ${index + 1}`}`}
              glyph="⧉"
              onClick={() => duplicateStep(index)}
            />
            <IconBtn
              label={`Delete ${step.name ?? `Step ${index + 1}`}`}
              glyph="×"
              onClick={() => deleteStep(index)}
            />
          </div>
        );
      })}

      <button
        type="button"
        onClick={addStep}
        data-testid="add-step"
        className="rounded border border-panelborder px-2 py-1 text-sm hover:border-accent"
      >
        + Step
      </button>

      <span
        className="ml-auto text-sm text-neutral-500"
        data-testid="editing-step"
      >
        Editing:{" "}
        {isBase
          ? "Base"
          : (steps[currentStepIndex]?.name ?? `Step ${currentStepIndex + 1}`)}
      </span>
    </footer>
  );
}

const chip = (active: boolean) =>
  `whitespace-nowrap rounded px-2 py-1 text-sm ${
    active ? "text-accent" : "text-neutral-300 hover:text-neutral-100"
  }`;

function IconBtn({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="px-1 text-xs text-neutral-500 hover:text-accent disabled:opacity-30"
    >
      {glyph}
    </button>
  );
}
