import { useShallow } from "zustand/react/shallow";
import type { MechFillStyle, ObjectStyle, PlanObject } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { selectObjectState } from "../store/selectors";

/** Round for display without fighting the user mid-edit. */
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Properties panel (plan §2.3): x/y, size, rotation, opacity, tint, label,
 * lock, and z-order for the selection. Edits go straight to the store, so each
 * one is a single undo entry (plan §2.7).
 */
export function PropertiesPanel() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const object = useEditorStore((s) =>
    s.selectedIds.length === 1 ? s.objects[s.selectedIds[0]!] : undefined,
  );
  /**
   * Show what's on the canvas — the base with the current step's overrides
   * applied — not the raw base. Editing a value writes it back to whichever of
   * the two the current step implies (see `writeOverridable`).
   */
  const state = useEditorStore(
    useShallow((s) =>
      s.selectedIds.length === 1
        ? selectObjectState(s, s.selectedIds[0]!)
        : undefined,
    ),
  );
  const updateObject = useEditorStore((s) => s.updateObject);
  const updateStyle = useEditorStore((s) => s.updateStyle);
  const setLocked = useEditorStore((s) => s.setLocked);
  const bringForward = useEditorStore((s) => s.bringForward);
  const sendBackward = useEditorStore((s) => s.sendBackward);
  const bringToFront = useEditorStore((s) => s.bringToFront);
  const sendToBack = useEditorStore((s) => s.sendToBack);

  return (
    <section aria-label="Properties" className="flex flex-col">
      <h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Properties
      </h2>

      {selectedIds.length === 0 && (
        <p data-testid="no-selection" className="px-3 text-sm text-neutral-500">
          No selection.
        </p>
      )}

      {selectedIds.length > 1 && (
        <p
          data-testid="multi-selection"
          className="px-3 text-sm text-neutral-400"
        >
          {selectedIds.length} objects selected.
        </p>
      )}

      {object && state && (
        <div data-testid="properties" className="flex flex-col gap-2 px-3 pb-4">
          <NumberField
            label="X"
            testId="prop-x"
            value={round(state.x)}
            onChange={(x) => updateObject(object.id, { x })}
          />
          <NumberField
            label="Y"
            testId="prop-y"
            value={round(state.y)}
            onChange={(y) => updateObject(object.id, { y })}
          />
          <NumberField
            label="Width"
            testId="prop-w"
            min={1}
            value={round(state.w)}
            onChange={(w) => updateObject(object.id, { w })}
          />
          <NumberField
            label="Height"
            testId="prop-h"
            min={0}
            value={round(state.h)}
            onChange={(h) => updateObject(object.id, { h })}
          />
          <NumberField
            label="Rotation"
            testId="prop-rotation"
            step={15}
            value={round(state.rotation)}
            onChange={(rotation) => updateObject(object.id, { rotation })}
          />
          <NumberField
            label="Opacity"
            testId="prop-opacity"
            step={0.1}
            min={0}
            max={1}
            value={round(state.opacity)}
            // Opacity is normalised 0..1 by the shared schema — clamp on input.
            onChange={(opacity) =>
              updateObject(object.id, {
                opacity: Math.min(1, Math.max(0, opacity)),
              })
            }
          />

          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-500">Name</span>
            <input
              type="text"
              data-testid="prop-name"
              placeholder="e.g. Tank 1"
              className="w-28 rounded border border-panelborder bg-neutral-900 px-2 py-1"
              value={object.base.name ?? ""}
              onChange={(e) =>
                updateObject(object.id, { name: e.target.value })
              }
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-500">Label</span>
            <input
              type="text"
              data-testid="prop-label"
              className="w-28 rounded border border-panelborder bg-neutral-900 px-2 py-1"
              value={object.base.label ?? ""}
              onChange={(e) =>
                updateObject(object.id, { label: e.target.value })
              }
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-500">Tint</span>
            <input
              type="color"
              data-testid="prop-tint"
              className="h-7 w-28 rounded border border-panelborder bg-neutral-900"
              value={object.base.tint ?? "#4f9dff"}
              onChange={(e) =>
                updateObject(object.id, { tint: e.target.value })
              }
            />
          </label>

          <StyleControls object={object} updateStyle={updateStyle} />

          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-500">Visible</span>
            <input
              type="checkbox"
              data-testid="prop-visible"
              checked={state.visible}
              onChange={(e) =>
                updateObject(object.id, { visible: e.target.checked })
              }
            />
          </label>

          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-neutral-500">Locked</span>
            <input
              type="checkbox"
              data-testid="prop-locked"
              checked={object.locked ?? false}
              onChange={(e) => setLocked(object.id, e.target.checked)}
            />
          </label>

          <div className="mt-1">
            <span className="text-sm text-neutral-500">Order</span>
            <div className="mt-1 grid grid-cols-4 gap-1">
              <OrderButton
                label="⤒"
                title="Bring to front"
                onClick={() => bringToFront(object.id)}
              />
              <OrderButton
                label="↑"
                title="Bring forward"
                onClick={() => bringForward(object.id)}
              />
              <OrderButton
                label="↓"
                title="Send backward"
                onClick={() => sendBackward(object.id)}
              />
              <OrderButton
                label="⤓"
                title="Send to back"
                onClick={() => sendToBack(object.id)}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  testId,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-neutral-500">{label}</span>
      <input
        type="number"
        data-testid={testId}
        className="w-28 rounded border border-panelborder bg-neutral-900 px-2 py-1 text-right tabular-nums"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          // Ignore intermediate states like "" or "-" while typing.
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

/** Fill choices offered per shape — curated so odd combos stay out of the UI. */
const FILL_OPTIONS: Record<string, MechFillStyle[]> = {
  voidzone: ["soft", "solid", "striped", "hazard", "none"],
  circle: ["soft", "solid", "striped", "none"],
  rect: ["soft", "solid", "none"],
  cone: ["soft", "solid", "none"],
  line: ["soft", "solid", "none"],
  soak: ["soft", "solid", "none"],
  pickup: ["soft", "solid", "none"],
};

/**
 * Form customization for the selected shape or tether (plan §2.4): fill,
 * outline, a voidzone's edge, a tether's line. Only shows what's relevant to
 * the selection; colour stays the Tint control above.
 */
function StyleControls({
  object,
  updateStyle,
}: {
  object: PlanObject;
  updateStyle: (id: string, patch: Partial<ObjectStyle>) => void;
}) {
  if (object.type === "tether") {
    return (
      <SelectRow
        label="Line"
        testId="style-line"
        value={object.style?.line ?? "squiggly"}
        options={["squiggly", "straight"]}
        onChange={(line) =>
          updateStyle(object.id, { line: line as "squiggly" | "straight" })
        }
      />
    );
  }

  if (object.type !== "shape") return null;

  const fills = FILL_OPTIONS[object.shape ?? "rect"] ?? [
    "soft",
    "solid",
    "none",
  ];
  const fillValue =
    object.style?.fill ?? (object.shape === "voidzone" ? "hazard" : "soft");

  return (
    <>
      <SelectRow
        label="Fill"
        testId="style-fill"
        value={fillValue}
        options={fills}
        onChange={(fill) =>
          updateStyle(object.id, { fill: fill as MechFillStyle })
        }
      />
      {object.shape === "voidzone" && (
        <SelectRow
          label="Edge"
          testId="style-edge"
          value={object.style?.edge ?? "scalloped"}
          options={["scalloped", "round"]}
          onChange={(edge) =>
            updateStyle(object.id, { edge: edge as "scalloped" | "round" })
          }
        />
      )}
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-neutral-500">Outline</span>
        <input
          type="checkbox"
          data-testid="style-outline"
          checked={object.style?.outline !== false}
          onChange={(e) =>
            updateStyle(object.id, { outline: e.target.checked })
          }
        />
      </label>
    </>
  );
}

function SelectRow({
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
        className="w-28 rounded border border-panelborder bg-neutral-900 px-1 py-1"
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

function OrderButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded border border-panelborder py-1 text-sm hover:border-accent"
    >
      {label}
    </button>
  );
}
