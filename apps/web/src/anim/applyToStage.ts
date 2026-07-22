import type { Stage } from "konva/lib/Stage";
import type { ObjectState } from "@raidplan/shared";

/** The attributes animation drives. `w`/`h` are absent on purpose: Konva sizes
 * a `Group`'s children, so resizing is React's job — the frame loop only moves,
 * rotates, fades and hides. */
const DRIVEN = ["x", "y", "rotation", "opacity", "visible"] as const;

/**
 * Push object state straight onto its Konva node (plan §8.1).
 *
 * The one place that decides *which* attributes animation drives. Both the
 * playback engine and the video exporter write frames this way, so a recorded
 * clip can't diverge from what playback shows.
 *
 * **Only the properties present in `props` are written.** Two timelines can run
 * on one object at once — a step's move and a collision's disappear — and each
 * must write what it animates and nothing else, or the last writer per frame
 * silently undoes the other.
 */
export function applyObjectState(
  stage: Stage | null,
  objectId: string,
  props: Partial<ObjectState>,
): void {
  const node = stage?.findOne(`#${objectId}`);
  if (!node) return;
  const attrs: Record<string, unknown> = {};
  for (const key of DRIVEN) {
    if (props[key] !== undefined) attrs[key] = props[key];
  }
  node.setAttrs(attrs);
}

/**
 * An object's state *right now*, read back off its Konva node.
 *
 * A triggered animation starts from where the object actually is rather than
 * snapping back to the step's start. `w`/`h` come from `fallback` because
 * {@link applyObjectState} never writes them.
 */
export function readObjectState(
  stage: Stage | null,
  objectId: string,
  fallback: ObjectState,
): ObjectState {
  const node = stage?.findOne(`#${objectId}`);
  if (!node) return fallback;
  return {
    ...fallback,
    x: node.x(),
    y: node.y(),
    rotation: node.rotation(),
    opacity: node.opacity(),
    visible: node.visible(),
  };
}

/** An object's current bounding box in native coords, for collision tests. */
export function objectRect(stage: Stage | null, objectId: string) {
  const node = stage?.findOne(`#${objectId}`);
  // A hidden object can't be hit — a consumed pickup stays consumed.
  if (!node || !node.visible()) return null;
  const layer = node.getLayer();
  return layer ? node.getClientRect({ relativeTo: layer }) : null;
}
