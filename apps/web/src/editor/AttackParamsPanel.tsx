import { useState } from "react";
import {
  ATTACK_PARAM_TYPES,
  type AttackBindings,
  type AttackParam,
  type AttackParamType,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";

/** Stable empty list: defaulting *inside* a selector returns a fresh array
 * every call, which never compares equal and re-renders forever. */
const NO_ANIMATIONS: never[] = [];

/**
 * Declaring an attack's parameters, in the designer (plan §18.4).
 *
 * Some behaviour can't live in a definition because it refers to things only the
 * using plan knows — above all *which objects set a collision off*. A parameter
 * is the blank left for that: declare one here, **point it at something inside
 * the attack**, and every plan that places the attack is asked to fill it in.
 *
 * Two halves, and the second is the one that's easy to miss: a parameter that
 * isn't pointed at anything does nothing at all. Hence the "supplies …" list on
 * every parameter, and the running summary of what a plan will be asked.
 *
 * A parameter can drive **as many places as it likes** — one "the tanks" answer
 * feeding three animations' collision targets is the whole point of naming it —
 * so each place is a tick-box rather than a choice. The reverse stays single:
 * a place reads from exactly one parameter, and one already spoken for says
 * which parameter has it.
 *
 * Binding is driven from the parameter rather than from the animation editor on
 * purpose: the animation panel is shared with the plan editor, and attacks have
 * no business leaking into it.
 */
const FIELD =
  "rounded border border-panelborder bg-neutral-900 px-1 py-0.5 text-xs";

/** Which slots a parameter of each type can drive. */
const SLOTS_FOR: Record<AttackParamType, (keyof AttackBindings)[]> = {
  objectRefs: ["collideWith"],
  number: ["durationMs", "delayMs"],
  color: ["tint"],
  text: [],
  boolean: [],
};

const ALL_SLOTS = [
  "collideWith",
  "durationMs",
  "delayMs",
  "tint",
] as const satisfies readonly (keyof AttackBindings)[];

/** Read as "supplies the …" — the thing inside the attack a parameter drives. */
const SLOT_LABEL: Record<keyof AttackBindings, string> = {
  collideWith: "collision targets of",
  durationMs: "duration of",
  delayMs: "delay of",
  tint: "colour of",
};

/** What the planner will be shown, so the author knows what they're asking for. */
const ASKED_FOR: Record<AttackParamType, string> = {
  objectRefs: "a tick-list of their own objects",
  number: "a number",
  color: "a colour",
  text: "some text",
  boolean: "a yes/no",
};

export function AttackParamsPanel({
  params,
  bindings,
  onParamsChange,
  onBindingsChange,
}: {
  params: AttackParam[];
  bindings: AttackBindings;
  onParamsChange: (next: AttackParam[]) => void;
  onBindingsChange: (next: AttackBindings) => void;
}) {
  const animations =
    useEditorStore((s) => s.steps[0]?.animations) ?? NO_ANIMATIONS;
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);

  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<AttackParamType>("objectRefs");

  const add = () => {
    const trimmed = key.trim();
    if (!trimmed || params.some((p) => p.key === trimmed)) return;
    onParamsChange([
      ...params,
      { key: trimmed, label: label.trim() || trimmed, type },
    ]);
    setKey("");
    setLabel("");
  };

  const remove = (paramKey: string) => {
    onParamsChange(params.filter((p) => p.key !== paramKey));
    // Drop any binding that pointed at it, so nothing dangles.
    const next: AttackBindings = {
      collideWith: {},
      durationMs: {},
      delayMs: {},
      tint: {},
    };
    for (const slot of ALL_SLOTS) {
      for (const [target, k] of Object.entries(bindings[slot])) {
        if (k !== paramKey) next[slot][target] = k;
      }
    }
    onBindingsChange(next);
  };

  /** Tick a place on or off for this parameter. Places are independent. */
  const bind = (
    slot: keyof AttackBindings,
    target: string,
    paramKey: string,
    on: boolean,
  ) => {
    const slotMap = { ...bindings[slot] };
    if (on) slotMap[target] = paramKey;
    else delete slotMap[target];
    onBindingsChange({ ...bindings, [slot]: slotMap });
  };

  /** How many places this parameter drives — zero means it does nothing. */
  const boundCount = (paramKey: string) =>
    ALL_SLOTS.reduce(
      (n, slot) =>
        n + Object.values(bindings[slot]).filter((k) => k === paramKey).length,
      0,
    );

  const nameOf = (id: string) => {
    const object = objects[id];
    return object?.base.name ?? object?.base.label ?? id;
  };

  const labelOfParam = (paramKey: string) =>
    params.find((p) => p.key === paramKey)?.label ?? paramKey;

  /**
   * "2. move · Cone" — an effect alone is unreadable once an attack has three
   * moves, and two moves on one object need the position to tell them apart.
   * The number is the animation's place in the step, as the timeline shows it.
   */
  const animLabel = (a: { effect: string; objectId: string }, index: number) =>
    `${index + 1}. ${a.effect} · ${nameOf(a.objectId)}`;

  return (
    <section
      className="border-t border-panelborder p-3"
      data-testid="attack-params-panel"
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">
        Parameters
      </h2>
      <p className="mb-2 text-xs text-neutral-500">
        A blank the plan fills in. Add one below, then point it at something
        inside this attack — a parameter that drives nothing is never asked for.
        The classic use is <em>who gets caught</em>: a definition can&apos;t
        know a plan&apos;s tokens, so it asks for them.
      </p>

      <ul className="mb-3 flex flex-col gap-2" data-testid="param-list">
        {params.length === 0 && (
          <li data-testid="no-params" className="text-xs text-neutral-500">
            None declared.
          </li>
        )}
        {params.map((param) => {
          const slots = SLOTS_FOR[param.type];
          const places = boundCount(param.key);
          return (
            <li
              key={param.key}
              className="flex flex-col gap-1 rounded border border-panelborder p-2"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-xs">
                  {param.label}{" "}
                  <span className="text-neutral-500">({param.type})</span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${param.label}`}
                  onClick={() => remove(param.key)}
                  className="rounded border border-panelborder px-1.5 py-0.5 text-xs text-amber-400 hover:border-amber-400"
                >
                  Remove
                </button>
              </div>

              {slots.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  Nothing inside an attack reads a {param.type} value yet — this
                  parameter is inert.
                </p>
              ) : (
                slots.map((slot) => (
                  <SlotChecklist
                    key={slot}
                    param={param}
                    slot={slot}
                    targets={
                      slot === "tint"
                        ? objectIds.map((id) => ({ id, label: nameOf(id) }))
                        : animations.map((a, index) => ({
                            id: a.id,
                            label: animLabel(a, index),
                          }))
                    }
                    bindings={bindings}
                    labelOfParam={labelOfParam}
                    onToggle={(target, on) => bind(slot, target, param.key, on)}
                  />
                ))
              )}

              {slots.length > 0 &&
                (places === 0 ? (
                  <p className="text-xs text-amber-400/80">
                    Not pointed at anything yet, so nothing in the attack would
                    use the answer.
                  </p>
                ) : (
                  <p className="text-xs text-neutral-500">
                    Plans are asked for {ASKED_FOR[param.type]}; it drives{" "}
                    {places} {places === 1 ? "place" : "places"}.
                  </p>
                ))}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-1">
        <input
          aria-label="New parameter key"
          placeholder="key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className={`${FIELD} w-20`}
        />
        <input
          aria-label="New parameter label"
          placeholder="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={`${FIELD} w-24`}
        />
        <select
          aria-label="New parameter type"
          value={type}
          onChange={(e) => setType(e.target.value as AttackParamType)}
          className={FIELD}
        >
          {ATTACK_PARAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Add parameter"
          onClick={add}
          disabled={!key.trim()}
          className="rounded border border-panelborder px-2 py-0.5 text-xs hover:border-accent disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </section>
  );
}

/**
 * Every place in the attack a parameter of this type could drive, as tick-boxes.
 *
 * A place already spoken for by another parameter is shown taken rather than
 * hidden: two parameters feeding one animation's collision targets is a
 * contradiction, and saying whose it is beats a box that silently won't tick.
 */
function SlotChecklist({
  param,
  slot,
  targets,
  bindings,
  labelOfParam,
  onToggle,
}: {
  param: AttackParam;
  slot: keyof AttackBindings;
  targets: { id: string; label: string }[];
  bindings: AttackBindings;
  labelOfParam: (paramKey: string) => string;
  onToggle: (target: string, on: boolean) => void;
}) {
  if (targets.length === 0) {
    return (
      <p
        data-testid={`no-targets-${param.key}-${slot}`}
        className="text-xs text-amber-400/80"
      >
        {slot === "tint"
          ? "Add an object for it to colour."
          : "Add an animation for it to drive."}
      </p>
    );
  }

  return (
    <fieldset className="flex flex-col gap-0.5 text-xs text-neutral-400">
      <legend className="text-xs text-neutral-400">
        supplies the {SLOT_LABEL[slot]}
      </legend>
      {targets.map((target) => {
        const owner = bindings[slot][target.id];
        const mine = owner === param.key;
        const taken = owner !== undefined && !mine;
        return (
          <label
            key={target.id}
            className={`flex items-center gap-1 ${taken ? "opacity-50" : ""}`}
          >
            <input
              type="checkbox"
              aria-label={`${param.label} ${SLOT_LABEL[slot]}: ${target.label}`}
              checked={mine}
              disabled={taken}
              onChange={(e) => onToggle(target.id, e.target.checked)}
            />
            <span className="truncate">{target.label}</span>
            {taken && (
              <span className="shrink-0 text-neutral-500">
                — {labelOfParam(owner)}
              </span>
            )}
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * Pinning the attack to the board (plan §18.15).
 *
 * A definition can hang off one of its placeholders and turn to face another —
 * a frontal from the boss at a player. Both are placeholders, because both are
 * objects only the plan knows; this just says which is which.
 */
export function AttackAnchorPanel({
  slots,
  anchor,
  onChange,
}: {
  slots: { id: string; label: string }[];
  anchor: { originId: string; facingId?: string } | undefined;
  onChange: (next: { originId: string; facingId?: string } | undefined) => void;
}) {
  return (
    <section
      className="border-t border-panelborder p-3"
      data-testid="attack-anchor-panel"
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">Anchor</h2>
      {slots.length === 0 ? (
        <p data-testid="anchor-needs-slot" className="text-xs text-neutral-500">
          Add a slot first — an attack follows one of the plan&apos;s objects,
          and a slot is how it asks for one.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-neutral-500">
            Placed copies follow these instead of sitting where they were
            dropped, and re-aim whenever either one moves.
          </p>
          <label className="flex items-center gap-1 text-xs text-neutral-400">
            hangs off
            <select
              aria-label="Anchor origin"
              value={anchor?.originId ?? ""}
              onChange={(e) =>
                onChange(
                  e.target.value
                    ? {
                        originId: e.target.value,
                        ...(anchor?.facingId
                          ? { facingId: anchor.facingId }
                          : {}),
                      }
                    : undefined,
                )
              }
              className={FIELD}
            >
              <option value="">nothing — stays where it&apos;s put</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}
                </option>
              ))}
            </select>
          </label>
          {anchor && (
            <label className="mt-1 flex items-center gap-1 text-xs text-neutral-400">
              and faces
              <select
                aria-label="Anchor facing"
                value={anchor.facingId ?? ""}
                onChange={(e) =>
                  onChange({
                    originId: anchor.originId,
                    ...(e.target.value ? { facingId: e.target.value } : {}),
                  })
                }
                className={FIELD}
              >
                <option value="">nothing — keeps its own rotation</option>
                {slots
                  .filter((slot) => slot.id !== anchor.originId)
                  .map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Parts that keep facing other parts (plan §18.16).
 *
 * Purely internal — both ends are the attack's own objects — so it needs no
 * slot and no plan. Each row turns one object to keep pointing at another as the
 * attack animates.
 */
export function AttackLookAtsPanel({
  objects,
  lookAts,
  onChange,
}: {
  objects: { id: string; label: string }[];
  lookAts: { objectId: string; targetId: string }[];
  onChange: (next: { objectId: string; targetId: string }[]) => void;
}) {
  const labelOf = (id: string) => objects.find((o) => o.id === id)?.label ?? id;

  const add = () => {
    const first = objects[0]?.id;
    const second = objects.find((o) => o.id !== first)?.id;
    if (!first || !second) return;
    onChange([...lookAts, { objectId: first, targetId: second }]);
  };

  const setRow = (
    index: number,
    patch: Partial<{ objectId: string; targetId: string }>,
  ) =>
    onChange(
      lookAts.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <section
      className="border-t border-panelborder p-3"
      data-testid="attack-lookats-panel"
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">Look-at</h2>
      {objects.length < 2 ? (
        <p
          data-testid="lookat-needs-parts"
          className="text-xs text-neutral-500"
        >
          Draw at least two objects — a look-at turns one to keep facing
          another.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-neutral-500">
            Keeps one part pointed at another as this attack&apos;s own
            animation moves it. No plan involved.
          </p>
          <ul className="mb-2 flex flex-col gap-2" data-testid="lookat-list">
            {lookAts.map((row, index) => (
              <li
                key={index}
                className="flex flex-col gap-1 rounded border border-panelborder p-2"
              >
                <div className="flex items-center gap-1 text-xs text-neutral-400">
                  <select
                    aria-label={`Look-at ${index} aimer`}
                    value={row.objectId}
                    onChange={(e) =>
                      setRow(index, { objectId: e.target.value })
                    }
                    className={FIELD}
                  >
                    {objects.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  faces
                  <select
                    aria-label={`Look-at ${index} target`}
                    value={row.targetId}
                    onChange={(e) =>
                      setRow(index, { targetId: e.target.value })
                    }
                    className={FIELD}
                  >
                    {objects
                      .filter((o) => o.id !== row.objectId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove look-at ${labelOf(row.objectId)}`}
                    onClick={() =>
                      onChange(lookAts.filter((_, i) => i !== index))
                    }
                    className="ml-auto rounded border border-panelborder px-1.5 py-0.5 text-amber-400 hover:border-amber-400"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            aria-label="Add look-at"
            onClick={add}
            className="rounded border border-panelborder px-2 py-0.5 text-xs hover:border-accent"
          >
            Add look-at
          </button>
        </>
      )}
    </section>
  );
}
