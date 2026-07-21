import { useEditorStore } from "../store/editorStore";
import { AttackArgs } from "./AttackArgs";

/**
 * The attacks placed on this plan (plan §18.3).
 *
 * Each job has one home: the **palette** places, the **canvas** positions and
 * sizes, the **timeline** says when within a step. So this is an inspector plus
 * the two things with nowhere else to live — which step an attack fires on, and
 * the arguments its definition asked the plan for. No number boxes at all.
 *
 * Attacks belong to the board rather than to a slide, so the list is the same
 * from the base layout as from any step; the one firing *here* is marked.
 */
export function AttacksPanel() {
  const encounterId = useEditorStore((s) => s.encounterId);
  const attacks = useEditorStore((s) => s.attacks);
  const steps = useEditorStore((s) => s.steps);
  const currentStepId = useEditorStore((s) => s.steps[s.currentStepIndex]?.id);
  const selectedAttackIds = useEditorStore((s) => s.selectedAttackIds);
  const selectAttack = useEditorStore((s) => s.selectAttack);
  const updateAttack = useEditorStore((s) => s.updateAttack);
  const removeAttack = useEditorStore((s) => s.removeAttack);
  const defsById = useEditorStore((s) => s.attackDefs);

  // No library, nothing to inspect.
  if (!encounterId) return null;

  return (
    <section
      className="border-t border-panelborder p-3"
      data-testid="attacks-panel"
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">Attacks</h2>

      {attacks.length === 0 && (
        <p data-testid="no-placed" className="text-xs text-neutral-500">
          None yet — drag one from the palette.
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="placed-attacks">
        {attacks.map((instance) => {
          const name = defsById[instance.attackId]?.name ?? "Attack";
          const isSelected = selectedAttackIds.includes(instance.id);
          const firesHere = instance.stepId === currentStepId;
          return (
            <li
              key={instance.id}
              // Canvas pixels aren't queryable, so selection is mirrored here
              // for the E2E suite.
              data-testid="placed-attack"
              data-selected={isSelected}
              className={`flex flex-col gap-1 rounded border p-2 ${
                isSelected ? "border-accent" : "border-panelborder"
              } ${firesHere ? "" : "opacity-60"}`}
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
                  onClick={() => removeAttack(instance.id)}
                  className="rounded border border-panelborder px-1.5 py-0.5 text-xs text-amber-400 hover:border-amber-400"
                >
                  Remove
                </button>
              </div>

              <label className="flex items-center gap-1 text-xs text-neutral-500">
                fires on
                <select
                  aria-label={`${name} fires on`}
                  value={instance.stepId}
                  onChange={(e) =>
                    updateAttack(instance.id, { stepId: e.target.value })
                  }
                  className="flex-1 rounded border border-panelborder bg-neutral-900 px-1 py-0.5 text-xs"
                >
                  {steps.map((step, index) => (
                    <option key={step.id} value={step.id}>
                      {step.name ?? `Step ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-neutral-500">
                {Math.round(instance.startMs)}ms in — drag its bar on the
                timeline to change that.
              </p>

              <AttackArgs
                params={defsById[instance.attackId]?.params ?? []}
                instance={instance}
                onChange={(key, value) =>
                  updateAttack(instance.id, {
                    args: { ...instance.args, [key]: value },
                  })
                }
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
