import type { Node } from "konva/lib/Node";
import type { Stage } from "konva/lib/Stage";
import type { ObjectState } from "@raidplan/shared";

/** Attributes written straight through. `w`/`h` are handled separately below. */
const DRIVEN = ["x", "y", "rotation", "opacity", "visible"] as const;

/**
 * Attributes a renderer stamps on a node to say what size it drew it at.
 *
 * Konva sizes a `Group` through its children, so an animator can't set a width
 * on it — but it can *scale* it, if it knows the size the children were drawn
 * at. The renderer knows, so it says: `baseW`/`baseH` are the object's `w`/`h`
 * as React last rendered them, and a size animation becomes a scale relative to
 * that. Without this, `scale` (and the size half of `pulse`) did nothing at all
 * during playback — React isn't in the frame loop, so nothing else could size
 * the node.
 */
export const BASE_SIZE_ATTRS = { w: "baseW", h: "baseH" } as const;

/** The scale that renders `size` on a node drawn at `baseAttr` pixels. */
function scaleFor(node: Node, size: number, baseAttr: string): number | null {
  const base = node.getAttr(baseAttr) as number | undefined;
  return typeof base === "number" && base > 0 ? size / base : null;
}

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
  // Size is expressed as a scale against the size the node was drawn at.
  if (props.w !== undefined) {
    const scaleX = scaleFor(node, props.w, BASE_SIZE_ATTRS.w);
    if (scaleX !== null) attrs["scaleX"] = scaleX;
  }
  if (props.h !== undefined) {
    const scaleY = scaleFor(node, props.h, BASE_SIZE_ATTRS.h);
    if (scaleY !== null) attrs["scaleY"] = scaleY;
  }
  node.setAttrs(attrs);
}

/**
 * An object's state *right now*, read back off its Konva node.
 *
 * A triggered animation starts from where the object actually is rather than
 * snapping back to the step's start — including mid-resize, which is why `w`/`h`
 * come back through the node's scale rather than from `fallback`.
 */
export function readObjectState(
  stage: Stage | null,
  objectId: string,
  fallback: ObjectState,
): ObjectState {
  const node = stage?.findOne(`#${objectId}`);
  if (!node) return fallback;
  const baseW = node.getAttr(BASE_SIZE_ATTRS.w) as number | undefined;
  const baseH = node.getAttr(BASE_SIZE_ATTRS.h) as number | undefined;
  return {
    ...fallback,
    x: node.x(),
    y: node.y(),
    rotation: node.rotation(),
    opacity: node.opacity(),
    visible: node.visible(),
    ...(typeof baseW === "number" ? { w: baseW * node.scaleX() } : {}),
    ...(typeof baseH === "number" ? { h: baseH * node.scaleY() } : {}),
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
