import { useShallow } from "zustand/react/shallow";
import { attackSlots, type ShapeKind } from "@raidplan/shared";
import { useEditorStore, viewCentreNative } from "../store/editorStore";
import { ATTACK_DATA_TYPE, SHAPE_DATA_TYPE } from "./paletteDrag";
import { useAttackPlacement } from "./useAttackPlacement";

/**
 * The palette's non-icon tabs (plan §18.5).
 *
 * Everything you can *add* to a plan now lives in one place on the left, and
 * every tile behaves the same way: click to drop it in the middle of the view,
 * or drag it onto the canvas to place it at the cursor.
 */
const tile =
  "flex flex-col items-center gap-1 rounded border border-transparent bg-neutral-800/40 p-2 text-xs text-neutral-300 hover:border-accent";

/** The primitives, labelled as a planner thinks of them (plan §2.4). */
const SHAPES: { kind: ShapeKind | "text" | "arrow"; label: string }[] = [
  { kind: "cone", label: "Cone" },
  { kind: "line", label: "Beam" },
  { kind: "soak", label: "Soak" },
  { kind: "voidzone", label: "Void" },
  { kind: "pickup", label: "Pickup" },
  { kind: "rect", label: "Rect" },
  { kind: "circle", label: "Circle" },
  { kind: "arrow", label: "Arrow" },
  { kind: "text", label: "Text" },
];

export function ShapesTab() {
  const addPrimitive = useEditorStore((s) => s.addPrimitive);

  return (
    <div className="grid grid-cols-3 gap-2 p-3" data-testid="shapes-tab">
      {SHAPES.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          aria-label={`Add ${label}`}
          onClick={() =>
            kind === "text" || kind === "arrow"
              ? addPrimitive(kind)
              : addPrimitive("shape", kind)
          }
          draggable
          onDragStart={(e) => e.dataTransfer.setData(SHAPE_DATA_TYPE, kind)}
          className={tile}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The plan's own attack library (plan §21).
 *
 * Everything here came from one of two places, and the badge says which: an
 * attack the encounter shipped with, copied in when the plan was made, or one
 * authored in this plan. Either way it is *this plan's* — nothing here reaches
 * anyone else's work, and nothing anyone else does reaches this.
 *
 * A definition with slots says what it needs before it will go anywhere, so the
 * requirement is visible before the refusal rather than only after it.
 */
export function AttacksTab() {
  const attacks = useEditorStore(useShallow((s) => s.attacks));
  const place = useAttackPlacement();

  if (attacks.length === 0) {
    return (
      <p className="p-3 text-xs text-neutral-400" data-testid="attacks-tab">
        No attacks yet. Make one from the Attacks panel, or start a plan from a
        map that ships with some.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-3" data-testid="attacks-tab">
      {attacks.map((def) => {
        const slots = attackSlots(def.objects);
        return (
          <button
            key={def.id}
            type="button"
            aria-label={`Place ${def.name}`}
            data-testid={`attack-tile-${def.id}`}
            onClick={() =>
              place(def.id, viewCentreNative(useEditorStore.getState()))
            }
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData(ATTACK_DATA_TYPE, def.id)
            }
            className="flex flex-col items-start gap-0.5 rounded border border-transparent bg-neutral-800/40 p-2 text-left text-xs text-neutral-200 hover:border-accent"
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="truncate font-medium">{def.name}</span>
              <span className="shrink-0 rounded bg-neutral-700/60 px-1 text-[10px] uppercase tracking-wide text-neutral-400">
                {def.source === "preset" ? "map" : "yours"}
              </span>
            </span>
            {slots.length > 0 ? (
              <span className="text-[11px] text-neutral-400">
                Needs {slots.map((slot) => slot.slotName).join(", ")}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
