import type {
  AttackInstance,
  AttackParam,
  AttackParamValue,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";

/**
 * Supplying a placed attack's arguments (plan §18.4).
 *
 * The definition declares what it needs; this is where the plan answers. The
 * important case is `objectRefs` — picking which of *this plan's* objects an
 * attack reacts to, which is exactly what couldn't be baked into a reusable
 * definition.
 */
const FIELD =
  "rounded border border-panelborder bg-neutral-900 px-1 py-0.5 text-xs";

export function AttackArgs({
  params,
  instance,
  onChange,
}: {
  params: AttackParam[];
  instance: AttackInstance;
  onChange: (key: string, value: AttackParamValue) => void;
}) {
  if (params.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="attack-args">
      {params.map((param) => (
        <ArgField
          key={param.key}
          param={param}
          value={instance.args[param.key] ?? param.default}
          onChange={(v) => onChange(param.key, v)}
        />
      ))}
    </div>
  );
}

function ArgField({
  param,
  value,
  onChange,
}: {
  param: AttackParam;
  value: AttackParamValue | undefined;
  onChange: (value: AttackParamValue) => void;
}) {
  const label = `${param.label}`;

  if (param.type === "objectRefs") {
    return <ObjectRefsField label={label} value={value} onChange={onChange} />;
  }

  if (param.type === "boolean") {
    return (
      <label className="flex items-center gap-1 text-xs text-neutral-400">
        <input
          type="checkbox"
          aria-label={label}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }

  return (
    <label className="flex items-center gap-1 text-xs text-neutral-400">
      {label}
      <input
        type={param.type === "number" ? "number" : "text"}
        aria-label={label}
        value={typeof value === "object" ? "" : String(value ?? "")}
        onChange={(e) =>
          onChange(
            param.type === "number" ? Number(e.target.value) : e.target.value,
          )
        }
        className={`${FIELD} flex-1`}
      />
    </label>
  );
}

/** Pick objects from *this plan* — the whole point of the parameter. */
function ObjectRefsField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AttackParamValue | undefined;
  onChange: (value: AttackParamValue) => void;
}) {
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);
  const chosen = Array.isArray(value) ? value : [];

  const toggle = (id: string) =>
    onChange(
      chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id],
    );

  return (
    <fieldset className="flex flex-col gap-0.5 text-xs text-neutral-400">
      <legend className="text-xs text-neutral-400">{label}</legend>
      {objectIds.length === 0 && (
        <span className="text-neutral-500">No objects to pick yet.</span>
      )}
      {objectIds.map((id) => {
        const object = objects[id];
        const name = object?.base.name ?? object?.base.label ?? id;
        return (
          <label key={id} className="flex items-center gap-1">
            <input
              type="checkbox"
              aria-label={`${label}: ${name}`}
              checked={chosen.includes(id)}
              onChange={() => toggle(id)}
            />
            <span className="truncate">{name}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
