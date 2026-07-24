import type { Follow } from "@raidplan/shared";

/**
 * Origin, direction and what a thing follows (plan §18.17).
 *
 * One control, used in three places — an ordinary object in the plan editor, a
 * part inside the attack designer, and a placed attack instance — because after
 * §18.17 those are the same question. It used to be three: an anchor panel that
 * needed a slot before it would talk to you, a look-at table with its own rows,
 * and nothing at all for plain objects.
 *
 * The origin is shown as a **percentage of the object's own box**, because that
 * is what it is, and because a planner reaching for it is thinking "a bit left
 * of the middle", not "0.35".
 */
export function FollowFields({
  ox,
  oy,
  dir,
  follow,
  choices,
  onOrigin,
  onFollow,
  testIdPrefix = "follow",
}: {
  ox: number | undefined;
  oy: number | undefined;
  dir: number | undefined;
  follow: Follow | undefined;
  /** What this thing may follow — everything else on the board, or in the def. */
  choices: { id: string; label: string }[];
  onOrigin: (patch: { ox?: number; oy?: number; dir?: number }) => void;
  onFollow: (next: Follow | undefined) => void;
  testIdPrefix?: string;
}) {
  /** Absent means centred; the field shows where it actually is, not blank. */
  const pct = (v: number | undefined, fallback: number) =>
    Math.round((v ?? fallback) * 100);

  const patchFollow = (patch: Follow) => {
    const next = { ...follow, ...patch };
    onFollow(next.pin || next.aim ? next : undefined);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-neutral-500">Origin</span>
        <div className="flex items-center gap-1">
          <PercentField
            aria-label="Origin X"
            testId={`${testIdPrefix}-ox`}
            value={pct(ox, 0.5)}
            onChange={(v) => onOrigin({ ox: v / 100 })}
          />
          <PercentField
            aria-label="Origin Y"
            testId={`${testIdPrefix}-oy`}
            value={pct(oy, 0.5)}
            onChange={(v) => onOrigin({ oy: v / 100 })}
          />
          <button
            type="button"
            title="Back to the middle"
            data-testid={`${testIdPrefix}-origin-reset`}
            onClick={() => onOrigin({ ox: 0.5, oy: 0.5 })}
            className="rounded border border-panelborder px-1.5 py-1 text-xs text-neutral-400 hover:text-neutral-200"
          >
            ⌖
          </button>
        </div>
      </div>

      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-neutral-500">Facing</span>
        <input
          type="number"
          step={15}
          data-testid={`${testIdPrefix}-dir`}
          className="w-28 rounded border border-panelborder bg-neutral-900 px-2 py-1"
          value={Math.round(dir ?? 0)}
          onChange={(e) => onOrigin({ dir: Number(e.target.value) || 0 })}
        />
      </label>

      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-neutral-500">Pin to</span>
        <select
          aria-label="Pin origin to"
          data-testid={`${testIdPrefix}-pin`}
          className="w-28 rounded border border-panelborder bg-neutral-900 px-2 py-1"
          value={follow?.pin ?? ""}
          onChange={(e) => patchFollow({ pin: e.target.value || undefined })}
        >
          <option value="">nothing — stays put</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-neutral-500">Aim at</span>
        <select
          aria-label="Aim direction at"
          data-testid={`${testIdPrefix}-aim`}
          className="w-28 rounded border border-panelborder bg-neutral-900 px-2 py-1"
          value={follow?.aim ?? ""}
          onChange={(e) => patchFollow({ aim: e.target.value || undefined })}
        >
          <option value="">nothing — keeps its angle</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PercentField({
  value,
  onChange,
  testId,
  ...rest
}: {
  value: number;
  onChange: (v: number) => void;
  testId: string;
  "aria-label": string;
}) {
  return (
    <input
      type="number"
      step={5}
      data-testid={testId}
      className="w-[3.25rem] rounded border border-panelborder bg-neutral-900 px-1.5 py-1"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      {...rest}
    />
  );
}
