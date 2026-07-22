import {
  attackSlots,
  type AttackDef,
  type AttackInstance,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { AttackArgs } from "./AttackArgs";
import { objectDisplayName } from "./objectName";

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
          // The instance's own name wins: with three copies of one attack, its
          // definition's name is the least useful thing to call it.
          const name =
            instance.name?.trim() ||
            defsById[instance.attackId]?.name ||
            "Attack";
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
                {Math.round(instance.startMs)}ms in
                {instance.durationMs !== undefined && (
                  <>
                    {" "}
                    · stretched to {Math.round(instance.durationMs)}ms{" "}
                    <button
                      type="button"
                      aria-label={`Reset ${name} duration`}
                      onClick={() =>
                        updateAttack(instance.id, { durationMs: undefined })
                      }
                      className="underline hover:text-accent"
                    >
                      reset
                    </button>
                  </>
                )}
                {" — "}drag its bar on the timeline to move it, its right edge
                to stretch it.
              </p>

              <AttackSlots
                def={defsById[instance.attackId]}
                instance={instance}
              />

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

/**
 * Which of the plan's objects fill this attack's holes (§18.14).
 *
 * Shown even though placement filled them from the selection: which token the
 * frontal is aimed at is a decision you revisit, and hunting for it by
 * re-placing the attack would be absurd.
 */
function AttackSlots({
  def,
  instance,
}: {
  def: AttackDef | undefined;
  instance: AttackInstance;
}) {
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);
  const updateAttack = useEditorStore((s) => s.updateAttack);

  const slots = def ? attackSlots(def) : [];
  if (slots.length === 0) return null;

  return (
    <div className="flex flex-col gap-1" data-testid="attack-slots">
      {slots.map((slot) => (
        <label
          key={slot.id}
          className="flex items-center gap-1 text-xs text-neutral-500"
        >
          {slot.base.name ?? "Slot"}
          <select
            aria-label={`${slot.base.name ?? "Slot"} is`}
            value={instance.slots[slot.id] ?? ""}
            onChange={(e) =>
              updateAttack(instance.id, {
                slots: { ...instance.slots, [slot.id]: e.target.value },
              })
            }
            className="flex-1 rounded border border-panelborder bg-neutral-900 px-1 py-0.5 text-xs"
          >
            {objectIds.map((id) => (
              <option key={id} value={id}>
                {objectDisplayName(objects[id])}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
