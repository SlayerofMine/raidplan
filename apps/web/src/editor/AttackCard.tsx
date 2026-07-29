import {
  ANIM_EFFECTS,
  MECH_FILL_STYLES,
  attackParamValue,
  attackSlots,
  slideAttacks,
  type AttackDef,
  type AttackInstance,
  type AttackParam,
  type AttackParamValue,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { objectDisplayName } from "./objectName";

/**
 * The placement, as one thing (plan §21).
 *
 * Selecting anything inside an attack shows this instead of its animations,
 * because the animations are **derived**: editing one of them by hand would be
 * overwritten the next time the placement moved, and offering an edit that
 * quietly comes undone is worse than not offering it. What can be said about a
 * placement is said here — its parameters, what fills its slots, when it starts
 * and how long it takes — and everything else is a matter for the definition, in
 * the designer, or for Detach.
 *
 * Detach is the escape hatch and is deliberately in reach: an attack is a head
 * start, not a cage.
 */
export function AttackCard({ instanceId }: { instanceId: string }) {
  const slideIndex = useEditorStore((s) => s.currentSlideIndex);
  const instance = useEditorStore(
    (s) => slideAttacks(s.slides[s.currentSlideIndex]!)[instanceId],
  );
  const def = useEditorStore((s) =>
    s.attacks.find((a) => a.id === instance?.defId),
  );
  const detachAttack = useEditorStore((s) => s.detachAttack);
  const deleteAttack = useEditorStore((s) => s.deleteAttack);

  if (!instance) return null;

  return (
    <div
      className="flex flex-col gap-2 rounded border border-accent/60 p-2"
      data-testid="attack-card"
      data-instance={instanceId}
      data-slide={slideIndex}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-neutral-200">
          {instance.name}
        </span>
        <span className="shrink-0 rounded bg-neutral-700/60 px-1 text-[10px] uppercase tracking-wide text-neutral-400">
          attack
        </span>
      </div>

      {def === undefined ? (
        // The library entry has gone, so there is nothing left to re-derive
        // from. The objects stay exactly where they are, which is the only
        // answer that doesn't throw away someone's work.
        <p className="text-xs text-neutral-500" data-testid="attack-orphan">
          This attack is no longer in the plan's library, so it can't be
          adjusted any more. Detach it to keep editing its objects.
        </p>
      ) : (
        <>
          <Placement instance={instance} />
          <Timing instance={instance} />
          {def.params.length > 0 && <Params def={def} instance={instance} />}
          <Slots def={def} instance={instance} />
        </>
      )}

      <div className="flex justify-end gap-3 text-xs">
        <button
          type="button"
          data-testid="attack-detach"
          title="Keep the objects, exactly where they are, and stop deriving them"
          onClick={() => detachAttack(instanceId)}
          className="text-neutral-400 hover:text-accent"
        >
          Detach
        </button>
        <button
          type="button"
          data-testid="attack-delete"
          title="Remove the attack and everything it owns"
          onClick={() => deleteAttack(instanceId)}
          className="text-neutral-400 hover:text-accent"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/**
 * How the placement is turned and stretched.
 *
 * Set outright rather than composed, which is what lets the two scale factors
 * differ: the handles on the board scale uniformly, because only a uniform
 * gesture composes onto an existing placement exactly. Written here, the
 * transform simply *is* what it says, so squashing an attack sideways is always
 * available and never approximate. Dragging on the board still moves it.
 */
function Placement({ instance }: { instance: AttackInstance }) {
  const setAttackTransform = useEditorStore((s) => s.setAttackTransform);
  const set = (patch: Partial<AttackInstance["transform"]>) =>
    setAttackTransform(instance.id, { ...instance.transform, ...patch });

  return (
    <div className="flex flex-col gap-1" data-testid="attack-placement">
      <NumberField
        label="Rotation"
        testId="attack-rotation"
        value={Math.round(instance.transform.rotationDeg)}
        min={-360}
        max={360}
        step={15}
        suffix="°"
        onChange={(rotationDeg) => set({ rotationDeg })}
      />
      <NumberField
        label="Width"
        testId="attack-scale-x"
        value={Math.round(instance.transform.sx * 100)}
        min={1}
        step={10}
        suffix="%"
        onChange={(percent) => set({ sx: Math.max(0.01, percent / 100) })}
      />
      <NumberField
        label="Height"
        testId="attack-scale-y"
        value={Math.round(instance.transform.sy * 100)}
        min={1}
        step={10}
        suffix="%"
        onChange={(percent) => set({ sy: Math.max(0.01, percent / 100) })}
      />
    </div>
  );
}

/** When the placement starts, and how far its authored timings stretch. */
function Timing({ instance }: { instance: AttackInstance }) {
  const setAttackTiming = useEditorStore((s) => s.setAttackTiming);

  return (
    <div className="flex flex-col gap-1">
      <NumberField
        label="Starts at"
        testId="attack-delay"
        value={instance.anchorDelayMs}
        step={50}
        suffix="ms"
        onChange={(anchorDelayMs) =>
          setAttackTiming(instance.id, { anchorDelayMs })
        }
      />
      <NumberField
        label="Speed"
        testId="attack-timescale"
        // Shown the way it reads — 200% is twice as long, not 2. Stored as the
        // factor the stamp multiplies the authored timings by.
        value={Math.round(instance.timeScale * 100)}
        step={10}
        suffix="%"
        onChange={(percent) =>
          setAttackTiming(instance.id, { timeScale: percent / 100 })
        }
      />
    </div>
  );
}

/** The values the definition's author chose to expose. */
function Params({
  def,
  instance,
}: {
  def: AttackDef;
  instance: AttackInstance;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid="attack-params">
      {def.params.map((param) => (
        <ParamField key={param.name} param={param} instance={instance} />
      ))}
    </div>
  );
}

function ParamField({
  param,
  instance,
}: {
  param: AttackParam;
  instance: AttackInstance;
}) {
  const setAttackParam = useEditorStore((s) => s.setAttackParam);
  const value = attackParamValue(param, instance.values);
  const set = (next: AttackParamValue) =>
    setAttackParam(instance.id, param.name, next);
  const testId = `attack-param-${param.name}`;

  switch (param.kind) {
    case "number":
      return (
        <NumberField
          label={param.label}
          testId={testId}
          value={typeof value === "number" ? value : 0}
          {...(param.min !== undefined ? { min: param.min } : {})}
          {...(param.max !== undefined ? { max: param.max } : {})}
          step={param.step ?? 1}
          onChange={set}
        />
      );
    case "color":
      return (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-neutral-500">{param.label}</span>
          <input
            type="color"
            data-testid={testId}
            value={typeof value === "string" ? value : "#ffffff"}
            onChange={(e) => set(e.target.value)}
            className="h-6 w-12 rounded border border-panelborder bg-neutral-900"
          />
        </label>
      );
    case "text":
      return (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-neutral-500">{param.label}</span>
          <input
            type="text"
            data-testid={testId}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set(e.target.value)}
            className="w-28 rounded border border-panelborder bg-neutral-900 px-2 py-0.5"
          />
        </label>
      );
    case "boolean":
      return (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-neutral-500">{param.label}</span>
          <input
            type="checkbox"
            data-testid={testId}
            checked={value === true}
            onChange={(e) => set(e.target.checked)}
          />
        </label>
      );
    case "choice":
      return (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-neutral-500">{param.label}</span>
          <select
            data-testid={testId}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => set(e.target.value)}
            className="rounded border border-panelborder bg-neutral-900 px-1 py-0.5"
          >
            {choicesFor(param).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>
      );
    case "objects":
      return (
        <ObjectSetField
          param={param}
          value={Array.isArray(value) ? value : []}
          onChange={set}
          testId={testId}
        />
      );
  }
}

/**
 * What a `choice` parameter may be set to.
 *
 * The author's own list where they gave one; otherwise the vocabulary the field
 * it drives already has, so exposing "which effect" never needs the options
 * typed out by hand.
 */
function choicesFor(param: AttackParam): readonly string[] {
  if (param.choices && param.choices.length > 0) return param.choices;
  const field = param.targets[0]?.field;
  if (field === "effect") return ANIM_EFFECTS;
  if (field === "fill") return MECH_FILL_STYLES;
  return [];
}

/**
 * A set of the plan's own objects — what an exposed `collideWith` is for.
 *
 * The ids here are the **plan's**, not the definition's: the point of the
 * author exposing this is to let the planner say "and this hurts these people",
 * which is a thing only the plan knows the names of.
 */
function ObjectSetField({
  param,
  value,
  onChange,
  testId,
}: {
  param: AttackParam;
  value: string[];
  onChange: (next: string[]) => void;
  testId: string;
}) {
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-sm text-neutral-500">{param.label}</span>
      <ul className="max-h-28 overflow-y-auto rounded border border-panelborder">
        {objectIds.map((id) => (
          <li key={id}>
            <label className="flex items-center gap-2 px-2 py-0.5 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={value.includes(id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, id]
                      : value.filter((x) => x !== id),
                  )
                }
              />
              <span className="truncate">{objectDisplayName(objects[id])}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the plan supplied for each hole the definition left. */
function Slots({
  def,
  instance,
}: {
  def: AttackDef;
  instance: AttackInstance;
}) {
  const setAttackSlot = useEditorStore((s) => s.setAttackSlot);
  const objects = useEditorStore((s) => s.objects);
  const slide = useEditorStore((s) => s.slides[s.currentSlideIndex]);
  const slots = attackSlots(def.objects);
  if (slots.length === 0 || !slide) return null;

  // Only what is in this scene: an attack lives on one slide, so binding it to
  // something that isn't on that slide would aim it at nothing.
  const candidates = Object.keys(slide.states).filter(
    (id) => objects[id]?.attackId !== instance.id,
  );

  return (
    <div className="flex flex-col gap-1" data-testid="attack-slots">
      {slots.map((slot) => (
        <label
          key={slot.id}
          className="flex items-center justify-between gap-2 text-sm"
        >
          <span className="truncate text-neutral-500">{slot.slotName}</span>
          <select
            data-testid={`attack-slot-${slot.id}`}
            value={instance.slots[slot.id] ?? ""}
            onChange={(e) =>
              setAttackSlot(instance.id, slot.id, e.target.value)
            }
            className="max-w-32 rounded border border-panelborder bg-neutral-900 px-1 py-0.5"
          >
            {candidates.map((id) => (
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

function NumberField({
  label,
  value,
  onChange,
  testId,
  min = 0,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="truncate text-neutral-500">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          data-testid={testId}
          value={value}
          min={min}
          {...(max !== undefined ? { max } : {})}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="w-20 rounded border border-panelborder bg-neutral-900 px-2 py-0.5 text-right tabular-nums"
        />
        {suffix ? (
          <span className="w-6 text-xs text-neutral-500">{suffix}</span>
        ) : null}
      </span>
    </label>
  );
}
