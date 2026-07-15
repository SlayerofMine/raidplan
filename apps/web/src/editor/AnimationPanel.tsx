import {
  ANIM_EFFECTS,
  ANIM_KINDS,
  ANIM_TRIGGERS,
  type Anim,
} from "@raidplan/shared";
import { BASE_STEP_INDEX, useEditorStore } from "../store/editorStore";

/** GSAP eases offered in the picker (plan §7: easing is a GSAP ease name). */
const EASINGS = [
  "none",
  "power1.out",
  "power2.out",
  "power2.inOut",
  "power3.out",
  "back.out",
  "elastic.out",
  "bounce.out",
];

/**
 * Animation authoring for the current step (plan §3.4): pick kind → effect →
 * trigger, then delay/duration/easing. Animations belong to a *step*, so the
 * panel is inert on the Base layout.
 */
export function AnimationPanel() {
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex);
  const step = useEditorStore((s) => s.steps[s.currentStepIndex]);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const addAnimation = useEditorStore((s) => s.addAnimation);

  if (currentStepIndex === BASE_STEP_INDEX) {
    return (
      <Section>
        <p data-testid="anim-base-hint" className="text-sm text-neutral-500">
          Animations belong to a step. Select or add one below.
        </p>
      </Section>
    );
  }
  if (!step) return null;

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;

  return (
    <Section>
      <button
        type="button"
        data-testid="add-animation"
        disabled={!selectedId}
        title={
          selectedId ? "Animate the selection" : "Select a single object first"
        }
        onClick={() => selectedId && addAnimation(currentStepIndex, selectedId)}
        className="w-full rounded border border-panelborder py-1 text-sm hover:border-accent disabled:opacity-40"
      >
        + Animate selection
      </button>

      {step.animations.length === 0 ? (
        <p data-testid="anim-empty" className="text-sm text-neutral-500">
          No animations on this step.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="anim-list">
          {step.animations.map((anim) => (
            <AnimationRow
              key={anim.id}
              anim={anim}
              stepIndex={currentStepIndex}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function AnimationRow({ anim, stepIndex }: { anim: Anim; stepIndex: number }) {
  const label = useEditorStore(
    (s) => s.objects[anim.objectId]?.base.label ?? anim.objectId,
  );
  const updateAnimation = useEditorStore((s) => s.updateAnimation);
  const deleteAnimation = useEditorStore((s) => s.deleteAnimation);
  const select = useEditorStore((s) => s.select);

  const patch = (p: Partial<Omit<Anim, "id">>) =>
    updateAnimation(stepIndex, anim.id, p);

  return (
    <li
      className="flex flex-col gap-1 rounded border border-panelborder p-2"
      data-testid="anim-row"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => select([anim.objectId])}
          className="truncate text-sm text-neutral-300 hover:text-accent"
          title="Select this object"
        >
          {label}
        </button>
        <button
          type="button"
          aria-label="Delete animation"
          onClick={() => deleteAnimation(stepIndex, anim.id)}
          className="text-xs text-neutral-500 hover:text-accent"
        >
          ×
        </button>
      </div>

      <Picker
        label="Kind"
        testId="anim-kind"
        value={anim.kind}
        options={ANIM_KINDS}
        onChange={(v) => patch({ kind: v as Anim["kind"] })}
      />
      <Picker
        label="Effect"
        testId="anim-effect"
        value={anim.effect}
        options={ANIM_EFFECTS}
        onChange={(v) => patch({ effect: v as Anim["effect"] })}
      />
      <Picker
        label="Trigger"
        testId="anim-trigger"
        value={anim.trigger}
        options={ANIM_TRIGGERS}
        onChange={(v) => patch({ trigger: v as Anim["trigger"] })}
      />
      <Picker
        label="Easing"
        testId="anim-easing"
        value={anim.easing}
        options={EASINGS}
        onChange={(v) => patch({ easing: v })}
      />
      <NumberRow
        label="Delay (ms)"
        testId="anim-delay"
        value={anim.delayMs}
        onChange={(v) => patch({ delayMs: Math.max(0, v) })}
      />
      <NumberRow
        label="Duration (ms)"
        testId="anim-duration"
        value={anim.durationMs}
        onChange={(v) => patch({ durationMs: Math.max(0, v) })}
      />
    </li>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-panelborder px-3 py-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Animations
      </h2>
      {children}
    </div>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-32 rounded border border-panelborder bg-neutral-900 px-1 py-0.5"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <input
        type="number"
        step={50}
        min={0}
        data-testid={testId}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-32 rounded border border-panelborder bg-neutral-900 px-2 py-0.5 text-right tabular-nums"
      />
    </label>
  );
}
