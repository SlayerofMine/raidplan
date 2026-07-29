import { useShallow } from "zustand/react/shallow";
import { Link, useParams } from "react-router-dom";
import { LuPencil } from "react-icons/lu";
import { attackSlots, type ShapeKind } from "@raidplan/shared";
import { useEditorStore, viewCentreNative } from "../store/editorStore";
import { ATTACK_DATA_TYPE, SHAPE_DATA_TYPE } from "./paletteDrag";
import { LOCAL_PLAN_ID } from "./planScope";
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
  const { id } = useParams<{ id: string }>();
  const planId = id ?? LOCAL_PLAN_ID;

  return (
    <div className="flex flex-col gap-1 p-3" data-testid="attacks-tab">
      <Link
        to={`/plan/${planId}/attack/new`}
        data-testid="attack-new"
        className="rounded border border-dashed border-panelborder py-1 text-center text-xs text-neutral-300 hover:border-accent hover:text-accent"
      >
        + New attack
      </Link>

      {attacks.length === 0 ? (
        <p className="pt-1 text-xs text-neutral-500">
          Nothing here yet. An attack is a mechanic you build once — its objects
          and its animations — and then drop into any slide of this plan.
        </p>
      ) : null}

      {attacks.map((def) => {
        const slots = attackSlots(def.objects);
        return (
          <div
            key={def.id}
            className="flex items-start gap-1 rounded border border-transparent bg-neutral-800/40 p-2 hover:border-accent"
          >
            <button
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
              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left text-xs text-neutral-200"
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
            {/* Editing a definition changes every *future* placement of it, and
                re-derives the ones already on the board when they next move. */}
            <Link
              to={`/plan/${planId}/attack/${def.id}`}
              aria-label={`Edit ${def.name}`}
              data-testid={`attack-edit-${def.id}`}
              title="Open in the Attack Designer"
              className="shrink-0 text-neutral-500 hover:text-accent"
            >
              <LuPencil aria-hidden />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
