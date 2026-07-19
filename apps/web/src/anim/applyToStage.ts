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
