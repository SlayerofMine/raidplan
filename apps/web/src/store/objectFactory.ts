import type { ObjectType, PlanObject, ShapeKind } from "@raidplan/shared";
import type { Point } from "../editor/canvas/coords";
import { nextObjectId } from "./ids";

/** Default on-canvas footprints (native px) per primitive. */
export const DEFAULT_ICON_SIZE = 64;
const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  token: { w: DEFAULT_ICON_SIZE, h: DEFAULT_ICON_SIZE },
  text: { w: 200, h: 40 },
  shape: { w: 160, h: 160 },
  // The arrow draws along the middle of its box; the box must have real height
  // or the Transformer's bounding box is degenerate and can't be grabbed.
  arrow: { w: 200, h: 24 },
};

interface CreateParams {
  type: ObjectType;
  center: Point;
  z: number;
  iconId?: string;
  shape?: ShapeKind;
  tint?: string;
  label?: string;
  size?: { w: number; h: number };
}

/**
 * Build a valid {@link PlanObject} centred on a native-space point. Returns a
 * full document object (shaped by the shared schema) so the store and, later,
 * the API always agree — every creation path funnels through here.
 */
export function createObject(params: CreateParams): PlanObject {
  const size = params.size ??
    DEFAULT_SIZES[params.type] ?? {
      w: DEFAULT_ICON_SIZE,
      h: DEFAULT_ICON_SIZE,
    };
  return {
    id: nextObjectId(),
    type: params.type,
    ...(params.iconId ? { iconId: params.iconId } : {}),
    ...(params.shape ? { shape: params.shape } : {}),
    base: {
      x: params.center.x - size.w / 2,
      y: params.center.y - size.h / 2,
      w: size.w,
      h: size.h,
      rotation: 0,
      opacity: 1,
      z: params.z,
      visible: true,
      ...(params.tint ? { tint: params.tint } : {}),
      ...(params.label ? { label: params.label } : {}),
    },
  };
}

/** Convenience: an icon-backed token (the palette's output). */
export function createIconObject(params: {
  iconId: string;
  center: Point;
  z: number;
  size?: number;
  tint?: string;
}): PlanObject {
  return createObject({
    type: "token",
    iconId: params.iconId,
    center: params.center,
    z: params.z,
    ...(params.tint ? { tint: params.tint } : {}),
    ...(params.size ? { size: { w: params.size, h: params.size } } : {}),
  });
}
