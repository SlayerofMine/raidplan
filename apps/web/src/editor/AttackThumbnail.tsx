import {
  attackContentBox,
  type AttackDef,
  type PlanObject,
} from "@raidplan/shared";

/**
 * A small silhouette of an attack, for browsing the library (plan §18.5).
 *
 * Definitions are stored in unit space (-1..1), so the thumbnail *is* the
 * definition drawn into its own viewBox — no scaling maths and no canvas. That
 * box is measured rather than assumed, so the silhouette fills its tile the way
 * the attack fills the rectangle it's placed in.
 *
 * It's a silhouette, not a faithful render: enough to tell a cone from a soak
 * and to see the layout at a glance.
 */
const DEFAULT_TINT = "#4f9dff";

/** Shapes that read as round; everything else is boxy enough as a rectangle. */
const ROUND = new Set(["circle", "soak", "voidzone", "pickup"]);

export function AttackThumbnail({ def }: { def: AttackDef }) {
  const box = attackContentBox(def) ?? { cx: 0, cy: 0, hx: 1, hy: 1 };
  return (
    <svg
      viewBox={`${box.cx - box.hx} ${box.cy - box.hy} ${box.hx * 2} ${box.hy * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className="h-full w-full"
    >
      {def.objects.map((object) => (
        <Silhouette key={object.id} object={object} />
      ))}
    </svg>
  );
}

function Silhouette({ object }: { object: PlanObject }) {
  // A tether is drawn from its endpoints, so it has no standalone silhouette.
  if (object.type === "tether") return null;
  const { x, y, w, h } = object.base;
  const colour = object.base.tint ?? DEFAULT_TINT;
  const round = object.type !== "shape" || ROUND.has(object.shape ?? "rect");

  return round ? (
    <ellipse
      cx={x + w / 2}
      cy={y + h / 2}
      rx={Math.max(w / 2, 0.02)}
      ry={Math.max(h / 2, 0.02)}
      fill={colour}
      fillOpacity={0.35}
      stroke={colour}
      strokeWidth={0.03}
    />
  ) : (
    <rect
      x={x}
      y={y}
      width={Math.max(w, 0.04)}
      height={Math.max(h, 0.04)}
      fill={colour}
      fillOpacity={0.35}
      stroke={colour}
      strokeWidth={0.03}
    />
  );
}
