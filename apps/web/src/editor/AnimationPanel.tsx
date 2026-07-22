import {
  ANIM_EFFECTS,
  ANIM_KINDS,
  ANIM_TRIGGERS,
  type Anim,
} from "@raidplan/shared";
import { BASE_STEP_INDEX, useEditorStore } from "../store/editorStore";
import { objectDisplayName } from "./objectName";

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
 * Animation authoring for the **selection** (plan §3.4): pick kind → effect →
 * trigger, then delay/duration/easing. Animations belong to a *step*, so the
 * panel is inert on the Base layout.
 *
 * Objects doing **the same thing** share one row: animating a selection gives
 * every member an identical animation, and having to make the same six edits
 * six times would undo the point of animating them together. A row edits all of
 * its animations at once, and splits the moment one of them differs — which
 * happens naturally when you select a single object and change just that one.
 *
 * It shows only what the selected objects do, because the Timeline below already
 * shows the step as a whole. That split is the same one the rest of the editor
 * makes: the properties column inspects what you picked, the timeline is the
 * overview — and a step with thirty animations is unreadable as a list of
 * dropdowns anyway. Clicking a bar in the timeline selects its object, so the
 * two halves navigate to each other.
 */
export function AnimationPanel() {
  const currentStepIndex = useEditorStore((s) => s.currentStepIndex);
  const step = useEditorStore((s) => s.steps[s.currentStepIndex]);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const animateSelection = useEditorStore((s) => s.animateSelection);

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

  const count = selectedIds.length;
  const mine = step.animations.filter((a) => selectedIds.includes(a.objectId));
  const elsewhere = step.animations.length - mine.length;
  const rows = groupAnimations(mine);

  return (
    <Section>
      <button
        type="button"
        data-testid="add-animation"
        disabled={count === 0}
        title={
          count === 0
            ? "Select something to animate"
            : "Give each selected object the same animation"
        }
        onClick={() => animateSelection(currentStepIndex)}
        className="w-full rounded border border-panelborder py-1 text-sm hover:border-accent disabled:opacity-40"
      >
        {count > 1 ? `+ Animate ${count} objects` : "+ Animate selection"}
      </button>

      {selectedIds.length === 0 ? (
        <p data-testid="anim-no-selection" className="text-sm text-neutral-500">
          Select an object to see what it does on this step. The timeline shows
          the whole step.
        </p>
      ) : mine.length === 0 ? (
        <p data-testid="anim-empty" className="text-sm text-neutral-500">
          Nothing animates the selection on this step yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="anim-list">
          {rows.map((row) => (
            <AnimationRow
              key={row[0]!.id}
              anims={row}
              stepIndex={currentStepIndex}
            />
          ))}
        </ul>
      )}

      {elsewhere > 0 && (
        <p data-testid="anim-elsewhere" className="text-xs text-neutral-600">
          {elsewhere} more on this step, on other objects — see the timeline.
        </p>
      )}
    </Section>
  );
}

/**
 * What makes two animations "the same thing", ignoring which object they belong
 * to and their identity. Everything a row can edit is in here, so a row can only
 * exist while its animations agree about all of it.
 */
function signatureOf(anim: Anim): string {
  return JSON.stringify([
    anim.kind,
    anim.effect,
    anim.trigger,
    anim.delayMs,
    anim.durationMs,
    anim.easing,
    [...(anim.collideWith ?? [])].sort(),
    anim.params ?? null,
  ]);
}

/**
 * Collapse identical animations into rows, in first-appearance order.
 *
 * Two animations on the *same* object never share a row: they're separate
 * things that happen to look alike, and merging them would make one of them
 * impossible to edit on its own.
 */
function groupAnimations(animations: readonly Anim[]): Anim[][] {
  const rows: Anim[][] = [];
  const byKey = new Map<string, Anim[]>();

  for (const anim of animations) {
    const signature = signatureOf(anim);
    // Nth animation of this object with this signature → Nth row for it.
    let occurrence = 0;
    let key = `${signature}#0`;
    while (byKey.get(key)?.some((a) => a.objectId === anim.objectId)) {
      key = `${signature}#${++occurrence}`;
    }
    const row = byKey.get(key);
    if (row) row.push(anim);
    else {
      const started = [anim];
      byKey.set(key, started);
      rows.push(started);
    }
  }
  return rows;
}

function AnimationRow({
  anims,
  stepIndex,
}: {
  anims: Anim[];
  stepIndex: number;
}) {
  const anim = anims[0]!;
  const objects = useEditorStore((s) => s.objects);
  const updateAnimations = useEditorStore((s) => s.updateAnimations);
  const deleteAnimations = useEditorStore((s) => s.deleteAnimations);
  const select = useEditorStore((s) => s.select);

  const ids = anims.map((a) => a.id);
  const objectIdsHere = [...new Set(anims.map((a) => a.objectId))];
  const label =
    objectIdsHere.length === 1
      ? objectDisplayName(objects[anim.objectId])
      : `${objectIdsHere.length} objects`;

  const patch = (p: Partial<Omit<Anim, "id">>) =>
    updateAnimations(stepIndex, ids, p);

  return (
    <li
      className="flex flex-col gap-1 rounded border border-panelborder p-2"
      data-testid="anim-row"
      data-objects={objectIdsHere.length}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => select(objectIdsHere)}
          className="truncate text-sm text-neutral-300 hover:text-accent"
          title={
            objectIdsHere.length === 1
              ? "Select this object"
              : "Select these objects — edits here apply to all of them"
          }
        >
          {label}
        </button>
        <button
          type="button"
          aria-label="Delete animation"
          onClick={() => deleteAnimations(stepIndex, ids)}
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
      {anim.trigger === "onCollision" && (
        <ColliderPicker
          anim={anim}
          animatedObjectIds={objectIdsHere}
          onChange={patch}
        />
      )}
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

/**
 * Which objects can set an `onCollision` animation off by touching this one
 * (plan §7) — the "able to pick up" group. Collision is checked with bounding
 * boxes during playback only, so this is purely authoring.
 */
function ColliderPicker({
  anim,
  animatedObjectIds,
  onChange,
}: {
  anim: Anim;
  /** Every object this row animates — none of them can be its own collider. */
  animatedObjectIds: string[];
  onChange: (patch: Partial<Omit<Anim, "id">>) => void;
}) {
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);

  const selected = anim.collideWith ?? [];
  // An object can't collide with itself — that would fire on frame one.
  const candidates = objectIds.filter((id) => !animatedObjectIds.includes(id));

  const toggle = (id: string, on: boolean) =>
    onChange({
      collideWith: on ? [...selected, id] : selected.filter((x) => x !== id),
    });

  return (
    <div className="flex flex-col gap-1" data-testid="anim-colliders">
      <span className="text-sm text-neutral-500">Collides with</span>
      {candidates.length === 0 ? (
        <p
          className="text-xs text-neutral-600"
          data-testid="anim-colliders-none"
        >
          Add another object to collide with.
        </p>
      ) : (
        <>
          <div className="max-h-32 overflow-y-auto rounded border border-panelborder">
            {candidates.map((id) => (
              <label
                key={id}
                className="flex items-center gap-2 px-2 py-0.5 text-sm text-neutral-300"
              >
                <input
                  type="checkbox"
                  data-testid={`anim-collider-${id}`}
                  checked={selected.includes(id)}
                  onChange={(e) => toggle(id, e.target.checked)}
                />
                <span className="truncate">
                  {objectDisplayName(objects[id])}
                </span>
              </label>
            ))}
          </div>
          {selected.length === 0 && (
            <p
              className="text-xs text-amber-500/80"
              data-testid="anim-colliders-empty"
            >
              Pick at least one — it can&apos;t trigger otherwise.
            </p>
          )}
        </>
      )}
    </div>
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
