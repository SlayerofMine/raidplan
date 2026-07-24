import { useRef } from "react";
import { Circle, Group, Line } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Vector2d } from "konva/lib/types";
import {
  angleDeg,
  facingDeg,
  pinTo,
  pivotFraction,
  pivotPoint,
  slidePinnedOrigin,
  type Pivoted,
} from "@raidplan/shared";
import { temporalStore, useEditorStore } from "../../store/editorStore";
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

  /**
   * Live state of an origin drag, kept off React so a 60fps gesture never
   * re-renders on its own account. Holds where the drag began so the whole
   * gesture can be rewound and re-applied as a *single* undo step, and — when
   * pinned — the anchor the crosshair is locked to.
   */
  const drag = useRef<{
    pinned: boolean;
    anchorAbs: Vector2d;
    base: Pivoted;
    start: { ox: number; oy: number; x?: number; y?: number };
    last: { ox: number; oy: number; x?: number; y?: number } | null;
  } | null>(null);

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

  // Whether this object hangs off another: its origin is welded to a pin, so
  // moving the origin should slide the *object*, not tear the origin off it.
  const pinned = Boolean(object.follow?.pin);

  /**
   * Put the origin at fraction `ox,oy` of the box, as one undoable step.
   *
   * On a free object this just moves the origin — a cone's apex belongs off the
   * shape, so the crosshair follows the cursor wherever it goes. On a **pinned**
   * object the origin is nailed to the attach point, so instead of letting the
   * crosshair wander off, we hold it there and translate the box the opposite
   * way: `pinTo` re-seats the box so the new origin lands back on the old pivot.
   * The visible result is the object sliding under a fixed pin (plan §18.17).
   */
  const setOrigin = (ox: number, oy: number) => {
    if (pinned) {
      const moved = pinTo({ ...transform, ox, oy }, pivot);
      updateObject(object.id, { ox, oy, x: moved.x, y: moved.y });
    } else {
      updateObject(object.id, { ox, oy });
    }
  };

  /**
   * Start of a drag. We stop recording history for the duration (a drag is one
   * gesture, not fifty edits) and snapshot where it began, so the move can be
   * rewound and committed as a single step when it ends.
   */
  const startOrigin = (e: KonvaEventObject<DragEvent>) => {
    temporalStore.getState().pause();
    drag.current = {
      pinned,
      anchorAbs: e.target.getAbsolutePosition(),
      base: transform,
      start: pinned
        ? {
            ox: transform.ox ?? 0.5,
            oy: transform.oy ?? 0.5,
            x: state.x,
            y: state.y,
          }
        : { ox: transform.ox ?? 0.5, oy: transform.oy ?? 0.5 },
      last: null,
    };
  };

  const moveOrigin = (e: KonvaEventObject<DragEvent>) => {
    const d = drag.current;
    if (!d) return;

    if (d.pinned) {
      // The crosshair is locked (see `dragBoundFunc`), so its own position is no
      // use — read the pointer directly and pull it into plan space. The body
      // then slides the *opposite* way, leaving the origin welded to the anchor.
      const stage = e.target.getStage();
      const layer = e.target.getLayer();
      const pointer = stage?.getPointerPosition();
      if (!stage || !layer || !pointer) return;
      const p = layer.getAbsoluteTransform().copy().invert().point(pointer);
      d.last = slidePinnedOrigin(d.base, p);
    } else {
      d.last = pivotFraction(d.base, e.target.position());
    }
    updateObject(object.id, d.last);
  };

  /**
   * End of a drag: fold the whole gesture into one undo step. Rewind to where
   * it began while still untracked, resume recording, then apply the final
   * placement once — so undo takes back the drag in a single press, not frame
   * by frame. React batches the two writes, so nothing flickers between them.
   */
  const endOrigin = () => {
    const d = drag.current;
    drag.current = null;
    const temporal = temporalStore.getState();
    if (d?.last) {
      updateObject(object.id, d.start);
      temporal.resume();
      updateObject(object.id, d.last);
    } else {
      temporal.resume();
    }
  };

  // Pinned: keep the crosshair pinned to the anchor so it never chases the
  // cursor — the object moves under it, not the other way round.
  const lockToAnchor = (pos: Vector2d): Vector2d =>
    drag.current?.anchorAbs ?? pos;

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
        dragBoundFunc={pinned ? lockToAnchor : undefined}
        onDragStart={startOrigin}
        onDragMove={moveOrigin}
        onDragEnd={endOrigin}
        onDblClick={() => setOrigin(0.5, 0.5)}
        onDblTap={() => setOrigin(0.5, 0.5)}
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
