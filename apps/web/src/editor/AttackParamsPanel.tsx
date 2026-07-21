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
 * using plan knows — above all *which objects set a collision off*. Here the
 * author declares what the plan must supply, then points one of the definition's
 * internals at it.
 *
 * Binding is driven from the parameter rather than from the animation editor on
 * purpose: the animation panel is shared with the plan editor, and attacks have
 * no business leaking into it.
 */
const FIELD =
  "rounded border border-panelborder bg-neutral-900 px-1 py-0.5 text-xs";

/** Which slot a parameter of each type can drive. */
const SLOT_FOR: Record<AttackParamType, keyof AttackBindings | null> = {
  objectRefs: "collideWith",
  number: "durationMs",
  color: "tint",
  text: null,
  boolean: null,
};

const SLOT_LABEL: Record<keyof AttackBindings, string> = {
  collideWith: "collides with",
  durationMs: "duration of",
  tint: "tint of",
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
      tint: {},
    };
    for (const slot of ["collideWith", "durationMs", "tint"] as const) {
      for (const [target, k] of Object.entries(bindings[slot])) {
        if (k !== paramKey) next[slot][target] = k;
      }
    }
    onBindingsChange(next);
  };

  const bind = (
    slot: keyof AttackBindings,
    target: string,
    paramKey: string,
  ) => {
    const slotMap = { ...bindings[slot] };
    if (target) slotMap[target] = paramKey;
    else {
      for (const [t, k] of Object.entries(slotMap)) {
        if (k === paramKey) delete slotMap[t];
      }
    }
    onBindingsChange({ ...bindings, [slot]: slotMap });
  };

  /** The target currently bound to this parameter in a slot, if any. */
  const boundTarget = (slot: keyof AttackBindings, paramKey: string) =>
    Object.entries(bindings[slot]).find(([, k]) => k === paramKey)?.[0] ?? "";

  const nameOf = (id: string) => {
    const object = objects[id];
    return object?.base.name ?? object?.base.label ?? id;
  };

  return (
    <section
      className="border-t border-panelborder p-3"
      data-testid="attack-params-panel"
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">
        Parameters
      </h2>
      <p className="mb-2 text-xs text-neutral-500">
        What the plan has to tell this attack — like who a pickup can be caught
        by.
      </p>

      <ul className="mb-3 flex flex-col gap-2" data-testid="param-list">
        {params.length === 0 && (
          <li data-testid="no-params" className="text-xs text-neutral-500">
            None declared.
          </li>
        )}
        {params.map((param) => {
          const slot = SLOT_FOR[param.type];
          const targets =
            slot === "tint"
              ? objectIds.map((id) => ({ id, label: nameOf(id) }))
              : animations.map((a) => ({ id: a.id, label: a.effect }));
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
              {slot && (
                <label className="flex items-center gap-1 text-xs text-neutral-400">
                  {SLOT_LABEL[slot]}
                  <select
                    aria-label={`${param.label} drives`}
                    value={boundTarget(slot, param.key)}
                    onChange={(e) => bind(slot, e.target.value, param.key)}
                    className={FIELD}
                  >
                    <option value="">nothing</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
