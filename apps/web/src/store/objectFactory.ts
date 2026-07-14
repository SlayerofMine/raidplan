import type { PlanObject } from "@raidplan/shared";

/** Default on-canvas size (native px) for a newly-added icon token. */
export const DEFAULT_ICON_SIZE = 64;

let counter = 0;

/** Process-unique object id. Not persisted-stable — ids only need uniqueness. */
export function nextObjectId(): string {
  counter += 1;
  return `obj_${Date.now().toString(36)}_${counter}`;
}

/**
 * Build a valid {@link PlanObject} icon token centred on a native-space point.
 * Returns a full document object (validated by the shared schema) so the store
 * and, later, the API agree on shape.
 */
export function createIconObject(params: {
  iconId: string;
  center: { x: number; y: number };
  z: number;
  size?: number;
}): PlanObject {
  const size = params.size ?? DEFAULT_ICON_SIZE;
  return {
    id: nextObjectId(),
    type: "token",
    iconId: params.iconId,
    base: {
      x: params.center.x - size / 2,
      y: params.center.y - size / 2,
      w: size,
      h: size,
      rotation: 0,
      opacity: 1,
      z: params.z,
      visible: true,
    },
  };
}
