import type { AttackInstance } from "@raidplan/shared";
import { BASE_STEP_INDEX, useEditorStore } from "../store/editorStore";

/**
 * Placing pre-designed attacks (plan §17, stage 5).
 *
 * A plan seeded from an encounter offers *that encounter's* attacks. Dropping
 * one stores an {@link AttackInstance} — an id and a transform — and nothing
 * else: the attack stays indivisible, and the viewer/preview expand it at render
 * time. The planner tunes only what an instance exposes: where, how big, which
 * way round, and when within the step.
 */
const NUM = "w-16 rounded border border-panelborder bg-neutral-900 px-1 py-0.5";

export function AttacksPanel() {
  const encounterId = useEditorStore((s) => s.encounterId);
  const stepIndex = useEditorStore((s) => s.currentStepIndex);
  const attacks = useEditorStore((s) => s.steps[s.currentStepIndex]?.attacks);
  const background = useEditorStore((s) => s.background);
  const addAttack = useEditorStore((s) => s.addAttack);
  // Loaded once per plan by `AttackDefResolver`, and shared with the canvas
  // preview and the WebM export so all three expand from the same defs.
  const defsById = useEditorStore((s) => s.attackDefs);
  const defs = Object.values(defsById);

  if (!encounterId) return null;

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
          <ul className="flex flex-col gap-2" data-testid="placed-attacks">
            {(attacks ?? []).map((instance) => (
              <PlacedAttack
                key={instance.id}
                stepIndex={stepIndex}
                instance={instance}
                name={defsById[instance.attackId]?.name ?? "Attack"}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function PlacedAttack({
  stepIndex,
  instance,
  name,
}: {
  stepIndex: number;
  instance: AttackInstance;
  name: string;
}) {
  const updateAttack = useEditorStore((s) => s.updateAttack);
  const removeAttack = useEditorStore((s) => s.removeAttack);
  const set = (patch: Partial<AttackInstance>) =>
    updateAttack(stepIndex, instance.id, patch);

  return (
    <li className="flex flex-col gap-1 rounded border border-panelborder p-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm">{name}</span>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={() => removeAttack(stepIndex, instance.id)}
          className="rounded border border-panelborder px-1.5 py-0.5 text-xs text-amber-400 hover:border-amber-400"
        >
          Remove
        </button>
      </div>
      <div className="flex flex-wrap gap-1 text-xs text-neutral-400">
        <label className="flex items-center gap-1">
          x
          <input
            type="number"
            aria-label={`${name} x`}
            value={instance.x}
            onChange={(e) => set({ x: Number(e.target.value) })}
            className={NUM}
          />
        </label>
        <label className="flex items-center gap-1">
          y
          <input
            type="number"
            aria-label={`${name} y`}
            value={instance.y}
            onChange={(e) => set({ y: Number(e.target.value) })}
            className={NUM}
          />
        </label>
        <label className="flex items-center gap-1">
          rot
          <input
            type="number"
            aria-label={`${name} rotation`}
            value={instance.rotation}
            onChange={(e) => set({ rotation: Number(e.target.value) })}
            className={NUM}
          />
        </label>
        <label className="flex items-center gap-1">
          w
          <input
            type="number"
            min="1"
            aria-label={`${name} width`}
            value={instance.w}
            onChange={(e) => set({ w: Number(e.target.value) || 1 })}
            className={NUM}
          />
        </label>
        <label className="flex items-center gap-1">
          h
          <input
            type="number"
            min="1"
            aria-label={`${name} height`}
            value={instance.h}
            onChange={(e) => set({ h: Number(e.target.value) || 1 })}
            className={NUM}
          />
        </label>
        <label className="flex items-center gap-1">
          start
          <input
            type="number"
            step="50"
            min="0"
            aria-label={`${name} start`}
            value={instance.startMs}
            onChange={(e) => set({ startMs: Number(e.target.value) })}
            className={NUM}
          />
          ms
        </label>
      </div>
    </li>
  );
}
