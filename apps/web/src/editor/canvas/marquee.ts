import type { PlanObject } from "@raidplan/shared";
import type { Point } from "./coords";

/**
 * Marquee (rubber-band) selection maths (plan §2.6 / §6 "marquee select").
 *
 * Framework-free and in **native** coordinates, so the geometry is unit-testable
 * without a canvas: the stage transform is undone by the caller before these run.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Below this drag distance (in *screen* px) a press is a click, not a marquee. */
export const MARQUEE_THRESHOLD_PX = 4;

/** Build a positive-sized rect from two opposite corners, dragged in any direction. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * The axis-aligned bounding box of an object, accounting for rotation. Konva
 * rotates a node about its own origin (its `x, y` top-left), so the four corners
 * are rotated about that point and then bounded.
 */
export function objectBounds(object: PlanObject): Rect {
  const { x, y, w, h, rotation } = object.base;
  if (!rotation) return { x, y, width: w, height: h };

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([cx, cy]) => ({
    x: x + cx! * cos - cy! * sin,
    y: y + cx! * sin + cy! * cos,
  }));

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** Do two axis-aligned rects overlap? Touching edges count as overlapping. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/**
 * The ids of every object the marquee touches, in the order given (i.e. z-order).
 *
 * Uses *intersection* rather than full containment — sweeping part of a token is
 * enough, which matches how Figma/Excalidraw behave and is far more forgiving on
 * a dense board. Hidden and locked objects are skipped: a lock exists precisely
 * so a stray sweep can't grab something, and you can't select what you can't see.
 * Tethers are skipped too — they have no box (their geometry is their endpoints),
 * so they're selected by clicking the line, not by a sweep.
 */
export function objectsInMarquee(
  objects: readonly PlanObject[],
  marquee: Rect,
): string[] {
  return objects
    .filter(
      (object) =>
        object.base.visible &&
        !object.locked &&
        object.type !== "tether" &&
        rectsIntersect(objectBounds(object), marquee),
    )
    .map((object) => object.id);
}
