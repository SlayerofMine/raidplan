import type { Point } from "./coords";

/** Default grid pitch in native pixels (plan §2.6 "grid + snapping"). */
export const DEFAULT_GRID_SIZE = 40;

/**
 * Snap a scalar to the nearest multiple of `grid`. A non-positive grid disables
 * snapping (returns the value untouched), so callers can pass the current grid
 * size without branching.
 */
export function snapValue(value: number, grid: number): number {
  if (!Number.isFinite(grid) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Snap both axes of a point to the grid. */
export function snapPoint(p: Point, grid: number): Point {
  return { x: snapValue(p.x, grid), y: snapValue(p.y, grid) };
}
