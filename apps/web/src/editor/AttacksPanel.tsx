import { BASE_STEP_INDEX, useEditorStore } from "../store/editorStore";

/**
 * The attacks placed on the current step (plan §18.3).
 *
 * **Placing** happens in the palette, alongside tokens and shapes; **position,
 * size and rotation** happen on the canvas. So this is purely an inspector for
 * what's already down: what's here, which one is selected, when each fires, and
 * removing one. No coordinate boxes, no second copy of the library.
 */
const NUM = "w-20 rounded border border-panelborder bg-neutral-900 px-1 py-0.5";

export function AttacksPanel() {
  const encounterId = useEditorStore((s) => s.encounterId);
  const stepIndex = useEditorStore((s) => s.currentStepIndex);
  const attacks = useEditorStore((s) => s.steps[s.currentStepIndex]?.attacks);
  const selectedAttackIds = useEditorStore((s) => s.selectedAttackIds);
  const selectAttack = useEditorStore((s) => s.selectAttack);
  const updateAttack = useEditorStore((s) => s.updateAttack);
  const removeAttack = useEditorStore((s) => s.removeAttack);
  const defsById = useEditorStore((s) => s.attackDefs);

  // Nothing to inspect: no library, or attacks can't exist on the base layout.
  if (!encounterId || stepIndex === BASE_STEP_INDEX) return null;

  const placed = attacks ?? [];

  return (
    <section
      className="border-t border-panelborder p-3"
      data-testid="attacks-panel"
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">
        Attacks on this step
      </h2>

      {placed.length === 0 && (
        <p data-testid="no-placed" className="text-xs text-neutral-500">
          None yet — drag one from the palette.
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="placed-attacks">
        {placed.map((instance) => {
          const name = defsById[instance.attackId]?.name ?? "Attack";
          const isSelected = selectedAttackIds.includes(instance.id);
          return (
            <li
              key={instance.id}
              // Canvas pixels aren't queryable, so selection is mirrored here
              // for the E2E suite.
              data-testid="placed-attack"
              data-selected={isSelected}
              className={`flex flex-col gap-1 rounded border p-2 ${
                isSelected ? "border-accent" : "border-panelborder"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => selectAttack([instance.id])}
                  aria-label={`Select ${name}`}
                  className="flex-1 truncate text-left text-sm hover:text-accent"
                >
                  {name}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => removeAttack(stepIndex, instance.id)}
                  className="rounded border border-panelborder px-1.5 py-0.5 text-xs text-amber-400 hover:border-amber-400"
                >
                  Remove
                </button>
              </div>
              <label className="flex items-center gap-1 text-xs text-neutral-400">
                starts
                <input
                  type="number"
                  step="50"
                  min="0"
                  aria-label={`${name} start`}
                  value={instance.startMs}
                  onChange={(e) =>
                    updateAttack(stepIndex, instance.id, {
                      startMs: Number(e.target.value),
                    })
                  }
                  className={NUM}
                />
                ms into the step
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
