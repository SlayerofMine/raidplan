import type { Stage } from "konva/lib/Stage";
import type { ObjectState } from "@raidplan/shared";

/**
 * Push a resolved object state straight onto its Konva node (plan §8.1).
 *
 * The one place that decides *which* attributes animation drives. Both the
 * playback engine and the video exporter write frames this way, so a recorded
 * clip can't diverge from what playback shows.
 *
 * `w`/`h` are deliberately not written: Konva sizes a `Group`'s children, so
 * resizing is React's job — the frame loop only moves, rotates, fades and hides.
 */
export function applyObjectState(
  stage: Stage | null,
  objectId: string,
  props: ObjectState,
): void {
  const node = stage?.findOne(`#${objectId}`);
  if (!node) return;
  node.setAttrs({
    x: props.x,
    y: props.y,
    rotation: props.rotation,
    opacity: props.opacity,
    visible: props.visible,
  });
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
