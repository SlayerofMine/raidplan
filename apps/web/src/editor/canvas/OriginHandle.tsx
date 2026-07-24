import { Circle, Group, Line } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  angleDeg,
  facingDeg,
  pivotFraction,
  pivotPoint,
  type Pivoted,
} from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { selectObjectState } from "../../store/selectors";

/** How far the direction arrow reaches, in plan pixels. */
const ARROW = 56;
/** The arrowhead's half-width and length. */
const HEAD = 7;
const ACCENT = "#f2c744";
/** The facing snaps to the same increments the rotate handle does. */
const SNAPS = [0, 45, 90, 135, 180, 225, 270, 315];
const SNAP_TOLERANCE = 6;

const snap = (deg: number): number => {
  const norm = ((deg % 360) + 360) % 360;
  const near = SNAPS.find((s) => Math.abs(norm - s) <= SNAP_TOLERANCE);
  return near ?? deg;
};

/**
 * The draggable **origin** and **direction**, the way a photo editor draws them
 * (plan §18.17).
 *
 * The crosshair is the point the object turns about and hangs from; the arrow is
 * which way it points. Both are properties of the thing itself, so they are
 * dragged on the thing rather than typed into a panel — and once they exist,
 * "pin this to the boss and aim it at the tank" is a sentence about two handles
 * a planner has already seen, not about two ghost objects they have to conjure.
 *
 * Shown for a single unlocked selection only. On a multi-selection there is no
 * one origin to move, and on a locked object nothing may be moved at all.
 */
export function OriginHandle() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const object = useEditorStore((s) =>
    s.selectedIds.length === 1 ? s.objects[s.selectedIds[0]!] : undefined,
  );
  const state = useEditorStore((s) =>
    s.selectedIds.length === 1
      ? selectObjectState(s, s.selectedIds[0]!)
      : undefined,
  );
  const updateObject = useEditorStore((s) => s.updateObject);

  if (selectedIds.length !== 1 || !object || !state) return null;
  // A tether is drawn from its endpoints and has no box to take a fraction of.
  if (object.locked || object.type === "tether") return null;

  const transform: Pivoted = {
    x: state.x,
    y: state.y,
    w: state.w,
    h: state.h,
    rotation: state.rotation,
    ox: object.base.ox,
    oy: object.base.oy,
    dir: object.base.dir,
  };
  const pivot = pivotPoint(transform);
  const facing = (facingDeg(transform) * Math.PI) / 180;
  const tip = {
    x: pivot.x + Math.cos(facing) * ARROW,
    y: pivot.y + Math.sin(facing) * ARROW,
  };

  const dragOrigin = (e: KonvaEventObject<DragEvent>) => {
    const { ox, oy } = pivotFraction(transform, e.target.position());
    updateObject(object.id, { ox, oy });
  };

  const dragTip = (e: KonvaEventObject<DragEvent>) => {
    const aim = angleDeg(pivot, e.target.position());
    // Stored in the object's *own* frame, so turning the object later carries
    // its facing round with it instead of leaving it pointing at the old angle.
    updateObject(object.id, { dir: snap(aim - state.rotation) });
  };

  return (
    <Group listening name="origin-handle">
      <Line
        points={[pivot.x, pivot.y, tip.x, tip.y]}
        stroke={ACCENT}
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        listening={false}
      />
      <Line
        points={[
          tip.x - Math.cos(facing) * HEAD - Math.sin(facing) * HEAD * 0.6,
          tip.y - Math.sin(facing) * HEAD + Math.cos(facing) * HEAD * 0.6,
          tip.x,
          tip.y,
          tip.x - Math.cos(facing) * HEAD + Math.sin(facing) * HEAD * 0.6,
          tip.y - Math.sin(facing) * HEAD - Math.cos(facing) * HEAD * 0.6,
        ]}
        stroke={ACCENT}
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        listening={false}
      />

      {/* The direction's grab point. */}
      <Circle
        name="direction-handle"
        x={tip.x}
        y={tip.y}
        radius={5}
        fill={ACCENT}
        stroke="#1c1917"
        strokeWidth={1}
        strokeScaleEnabled={false}
        draggable
        onDragMove={dragTip}
        onDragEnd={dragTip}
      />

      {/* The origin itself: a ring with a dot, so it reads as a point and not a
          handle you resize. Double-click puts it back in the middle. */}
      <Group
        name="origin-crosshair"
        x={pivot.x}
        y={pivot.y}
        draggable
        onDragMove={dragOrigin}
        onDragEnd={dragOrigin}
        onDblClick={() => updateObject(object.id, { ox: 0.5, oy: 0.5 })}
        onDblTap={() => updateObject(object.id, { ox: 0.5, oy: 0.5 })}
      >
        <Circle
          radius={7}
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          fill="rgba(0,0,0,0.35)"
        />
        <Circle radius={2} fill={ACCENT} />
      </Group>
    </Group>
  );
}
