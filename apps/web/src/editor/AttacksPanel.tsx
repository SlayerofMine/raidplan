import { BASE_STEP_INDEX, useEditorStore } from "../store/editorStore";

/**
 * Placing pre-designed attacks (plan §17, reworked in §18.3).
 *
 * A plan seeded from an encounter offers *that encounter's* attacks. Dropping one
 * stores only a reference and a rectangle, so the attack stays indivisible.
 *
 * **Position, size and rotation are edited on the canvas** — a placed attack is a
 * selectable, draggable, transformable item like any other, so there are no
 * coordinate boxes here. What's left is what the canvas can't express: when the
 * attack fires within its step.
 */
const NUM = "w-20 rounded border border-panelborder bg-neutral-900 px-1 py-0.5";

export function AttacksPanel() {
  const encounterId = useEditorStore((s) => s.encounterId);
  const stepIndex = useEditorStore((s) => s.currentStepIndex);
  const attacks = useEditorStore((s) => s.steps[s.currentStepIndex]?.attacks);
  const selectedAttackIds = useEditorStore((s) => s.selectedAttackIds);
  const background = useEditorStore((s) => s.background);
  const addAttack = useEditorStore((s) => s.addAttack);
  const selectAttack = useEditorStore((s) => s.selectAttack);
  const updateAttack = useEditorStore((s) => s.updateAttack);
  const removeAttack = useEditorStore((s) => s.removeAttack);
  // Loaded once per plan by `AttackDefResolver`, and shared with the canvas and
  // the WebM export so all three expand from the same defs.
  const defsById = useEditorStore((s) => s.attackDefs);
  const defs = Object.values(defsById);

  if (!encounterId) return null;

  const nameOf = (attackId: string) => defsById[attackId]?.name ?? "Attack";

  return (
    <section
      className="border-t border-panelborder p-3"
      data-testid="attacks-panel"
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">Attacks</h2>

      {stepIndex === BASE_STEP_INDEX ? (
        <p data-testid="attacks-need-step" className="text-xs text-neutral-500">
          Attacks belong to a step — pick one below to place them.
        </p>
      ) : (
        <>
          <ul className="mb-3 flex flex-col gap-1">
            {defs.length === 0 && (
              <li data-testid="no-attacks" className="text-xs text-neutral-500">
                This encounter has no attacks yet.
              </li>
            )}
            {defs.map((def) => (
              <li key={def.id} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm">{def.name}</span>
                <button
                  type="button"
                  aria-label={`Place ${def.name}`}
                  onClick={() =>
                    addAttack(stepIndex, def.id, {
                      x: background.width / 2,
                      y: background.height / 2,
                    })
                  }
                  className="rounded border border-panelborder px-2 py-0.5 text-xs hover:border-accent"
                >
                  Place
                </button>
              </li>
            ))}
          </ul>

          <h3 className="mb-1 text-xs font-semibold text-neutral-400">
            On this step
          </h3>
          {(attacks ?? []).length === 0 && (
            <p data-testid="no-placed" className="text-xs text-neutral-500">
              Nothing placed yet.
            </p>
          )}
          <ul className="flex flex-col gap-1" data-testid="placed-attacks">
            {(attacks ?? []).map((instance) => {
              const name = nameOf(instance.attackId);
              const isSelected = selectedAttackIds.includes(instance.id);
              return (
                <li
                  key={instance.id}
                  // Canvas pixels aren't queryable, so selection is mirrored
                  // here for the E2E suite.
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
        </>
      )}
    </section>
  );
}
