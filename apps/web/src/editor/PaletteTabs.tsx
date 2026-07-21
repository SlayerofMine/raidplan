import type { ShapeKind } from "@raidplan/shared";
import { BASE_STEP_INDEX, useEditorStore } from "../store/editorStore";
import { AttackThumbnail } from "./AttackThumbnail";
import { ATTACK_DATA_TYPE, SHAPE_DATA_TYPE } from "./paletteDrag";

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

export function AttacksTab() {
  const encounterId = useEditorStore((s) => s.encounterId);
  const stepIndex = useEditorStore((s) => s.currentStepIndex);
  const background = useEditorStore((s) => s.background);
  const addAttack = useEditorStore((s) => s.addAttack);
  const defs = Object.values(useEditorStore((s) => s.attackDefs));

  if (!encounterId) {
    return (
      <p
        data-testid="attacks-no-encounter"
        className="p-3 text-xs text-neutral-500"
      >
        This plan isn’t tied to an encounter, so it has no attack library.
      </p>
    );
  }
  if (stepIndex === BASE_STEP_INDEX) {
    return (
      <p
        data-testid="attacks-need-step"
        className="p-3 text-xs text-neutral-500"
      >
        Attacks belong to a step — pick one below to place them.
      </p>
    );
  }
  if (defs.length === 0) {
    return (
      <p data-testid="no-attacks" className="p-3 text-xs text-neutral-500">
        This encounter has no attacks yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-3" data-testid="attacks-tab">
      {defs.map((def) => (
        <button
          key={def.id}
          type="button"
          title={def.name}
          aria-label={`Place ${def.name}`}
          onClick={() =>
            addAttack(stepIndex, def.id, {
              x: background.width / 2,
              y: background.height / 2,
            })
          }
          draggable
          onDragStart={(e) => e.dataTransfer.setData(ATTACK_DATA_TYPE, def.id)}
          className={tile}
        >
          <span className="pointer-events-none aspect-square w-full">
            <AttackThumbnail def={def} />
          </span>
          <span className="w-full truncate text-center">{def.name}</span>
        </button>
      ))}
    </div>
  );
}
