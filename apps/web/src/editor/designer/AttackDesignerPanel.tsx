import { useState } from "react";
import {
  ATTACK_FIELD_NAMES,
  attackFieldKind,
  attackFieldSide,
  attackSlots,
  wouldDegrade,
  type AttackField,
  type AttackParam,
  type AttackParamValue,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { objectDisplayName } from "../objectName";

/**
 * The designer's three extras (plan §21).
 *
 * Everything else in this window is the ordinary editor: the same canvas, the
 * same properties column, the same timeline. What a definition can say that a
 * plan cannot is **slots** — a hole for the using plan to fill — and
 * **parameters** — a value the using plan may choose. This panel is where those
 * two get said, and where the definition is named and saved.
 */
export function AttackDesignerPanel({
  name,
  onNameChange,
  params,
  onParamsChange,
  onSave,
  onDiscard,
  onPublish,
  saving,
  error,
}: {
  name: string;
  onNameChange: (name: string) => void;
  params: AttackParam[];
  onParamsChange: (params: AttackParam[]) => void;
  onSave: () => void;
  onDiscard: () => void;
  onPublish?: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div
      className="flex min-h-0 gap-4 overflow-x-auto border-t border-panelborder bg-panel px-3 py-2"
      data-testid="attack-designer-panel"
    >
      <section className="flex w-56 shrink-0 flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs text-neutral-400">
          Attack name
          <input
            type="text"
            data-testid="attack-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="rounded border border-panelborder bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="attack-save"
            disabled={saving}
            onClick={onSave}
            className="flex-1 rounded border border-accent py-1 text-sm text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save attack"}
          </button>
          <button
            type="button"
            data-testid="attack-discard"
            onClick={onDiscard}
            className="rounded border border-panelborder px-2 py-1 text-sm text-neutral-400 hover:border-accent"
          >
            Discard
          </button>
        </div>
        {onPublish ? (
          <button
            type="button"
            data-testid="attack-publish"
            disabled={saving}
            onClick={onPublish}
            title="Every plan made from this map in future starts with a copy. Plans that already exist keep theirs."
            className="rounded border border-panelborder py-1 text-xs text-neutral-300 hover:border-accent disabled:opacity-40"
          >
            Ship with this map
          </button>
        ) : null}
        {error ? (
          <p className="text-xs text-rose-400" data-testid="attack-save-error">
            {error}
          </p>
        ) : null}
      </section>

      <SlotList />
      <ParamList params={params} onChange={onParamsChange} />
    </div>
  );
}

/**
 * The holes this definition leaves for the using plan.
 *
 * A slot *is* an object with a name on it, so this is a list of what the
 * definition already has rather than a second place to keep membership. Marking
 * one is done in the properties column, where the object is; this says what the
 * planner will be asked for, in the order they will be asked.
 */
function SlotList() {
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);
  const select = useEditorStore((s) => s.select);
  const slots = attackSlots(
    objectIds.map((id) => objects[id]!).filter(Boolean),
  );

  return (
    <section
      className="flex w-52 shrink-0 flex-col gap-1"
      data-testid="slot-list"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Slots
      </h3>
      {slots.length === 0 ? (
        <p className="text-xs text-neutral-500">
          None. Pick an object and mark it a slot to have the plan supply it —
          the tank this lands on, say.
        </p>
      ) : (
        <ol className="flex flex-col gap-0.5 text-xs text-neutral-300">
          {slots.map((slot, i) => (
            <li key={slot.id}>
              <button
                type="button"
                onClick={() => select([slot.id])}
                className="truncate hover:text-accent"
              >
                {i + 1}. {slot.slotName}
              </button>
            </li>
          ))}
        </ol>
      )}
      <ScaleLint />
    </section>
  );
}

/**
 * A warning the author can act on while it is still cheap.
 *
 * A member turned to an odd angle cannot be scaled unevenly — the result would
 * be a sheared box, which a slide state cannot hold, so the stamp falls back to
 * scaling it evenly (see `attackTransform.ts`). Better said here, once, than
 * discovered by a planner wondering why one piece did not squash.
 */
function ScaleLint() {
  const objectIds = useEditorStore((s) => s.objectIds);
  const slide = useEditorStore((s) => s.slides[0]);
  const objects = useEditorStore((s) => s.objects);
  const skewed = objectIds.filter((id) => {
    const state = slide?.states[id];
    return (
      state !== undefined &&
      wouldDegrade(state.rotation, {
        tx: 0,
        ty: 0,
        rotationDeg: 0,
        sx: 1,
        sy: 2,
      })
    );
  });
  if (skewed.length === 0) return null;

  return (
    <p
      className="text-[11px] text-amber-400/90"
      data-testid="attack-scale-lint"
    >
      {skewed.length === 1
        ? `${objectDisplayName(objects[skewed[0]!])} is`
        : `${skewed.length} objects are`}{" "}
      turned off-square, so squashing this attack in one direction will scale{" "}
      {skewed.length === 1 ? "it" : "them"} evenly instead.
    </p>
  );
}

/** The values the planner may choose, and what each one drives. */
function ParamList({
  params,
  onChange,
}: {
  params: AttackParam[];
  onChange: (params: AttackParam[]) => void;
}) {
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);
  const animations = useEditorStore((s) => s.slides[0]?.animations ?? []);
  const [target, setTarget] = useState("");
  const [field, setField] = useState<AttackField>("tint");

  const targets = [
    ...objectIds.map((id) => ({
      on: "object" as const,
      id,
      label: objectDisplayName(objects[id]),
    })),
    ...animations.map((a) => ({
      on: "anim" as const,
      id: a.id,
      label: `${a.effect} · ${objectDisplayName(objects[a.objectId])}`,
    })),
  ];
  const chosen = targets.find((t) => t.id === target) ?? targets[0];
  // Only the fields that belong to the side the chosen target is on — a
  // duration is not a thing an object has.
  const fields = ATTACK_FIELD_NAMES.filter(
    (f) => chosen && attackFieldSide(f) === chosen.on,
  );
  const usable = fields.includes(field) ? field : fields[0];

  const add = () => {
    if (!chosen || !usable) return;
    const name = uniqueName(params, usable);
    onChange([
      ...params,
      {
        name,
        label: `${usable} of ${chosen.label}`,
        kind: attackFieldKind(usable),
        value: startingValue(usable),
        targets: [{ on: chosen.on, targetId: chosen.id, field: usable }],
      },
    ]);
  };

  return (
    <section
      className="flex min-w-64 flex-1 flex-col gap-1"
      data-testid="param-list"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Parameters
      </h3>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <select
          data-testid="param-target"
          value={chosen?.id ?? ""}
          onChange={(e) => setTarget(e.target.value)}
          className="max-w-40 rounded border border-panelborder bg-neutral-900 px-1 py-0.5"
        >
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          data-testid="param-field"
          value={usable ?? ""}
          onChange={(e) => setField(e.target.value as AttackField)}
          className="rounded border border-panelborder bg-neutral-900 px-1 py-0.5"
        >
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="param-add"
          disabled={!chosen || !usable}
          onClick={add}
          className="rounded border border-panelborder px-2 py-0.5 hover:border-accent disabled:opacity-40"
        >
          Expose
        </button>
      </div>

      {params.length === 0 ? (
        <p className="text-xs text-neutral-500">
          Nothing exposed. A parameter lets whoever places this attack change
          one thing about it — a colour, a cast time, who it hurts — without
          re-authoring it.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5" data-testid="params">
          {params.map((param) => (
            <li
              key={param.name}
              className="flex items-center gap-1 text-xs text-neutral-300"
            >
              <input
                type="text"
                aria-label={`Label for ${param.name}`}
                data-testid={`param-label-${param.name}`}
                value={param.label}
                onChange={(e) =>
                  onChange(
                    params.map((p) =>
                      p.name === param.name
                        ? { ...p, label: e.target.value }
                        : p,
                    ),
                  )
                }
                className="min-w-0 flex-1 rounded border border-panelborder bg-neutral-900 px-1 py-0.5"
              />
              <span className="shrink-0 text-neutral-500">{param.kind}</span>
              <button
                type="button"
                aria-label={`Remove ${param.label}`}
                data-testid={`param-remove-${param.name}`}
                onClick={() =>
                  onChange(params.filter((p) => p.name !== param.name))
                }
                className="shrink-0 text-neutral-500 hover:text-accent"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A stable key that doesn't collide with one already exposed. */
function uniqueName(
  params: readonly AttackParam[],
  field: AttackField,
): string {
  let name = field as string;
  let n = 1;
  while (params.some((p) => p.name === name)) name = `${field}${++n}`;
  return name;
}

/**
 * A starting value of the right kind for the field.
 *
 * Deliberately a plain neutral rather than the document's own value read back
 * through the store: a parameter's default is editable the moment it exists (it
 * is just a placement with no value of its own), and reaching into three
 * different shapes to find "the current tint" would be a second copy of the
 * stamp's binding table with its own way of being wrong.
 */
function startingValue(field: AttackField): AttackParamValue {
  switch (attackFieldKind(field)) {
    case "number":
      return field === "opacity" ? 1 : field === "curve" ? 0 : 500;
    case "color":
      return "#ffffff";
    case "boolean":
      return false;
    case "objects":
      return [];
    default:
      return field === "easing" ? "power2.out" : "";
  }
}
