/**
 * Pure coordinate math for the canvas (plan §6 "Pan & zoom", §1.2 acceptance).
 *
 * The Konva `Stage` is transformed by a {@link View}: every object is stored in
 * the background's **native pixel space**, and the stage applies a uniform
 * `scale` plus a `(x, y)` translation to map native → screen. Keeping this math
 * here (framework-free) makes "positions stable across zoom/resize" a property
 * we can unit-test without mounting a canvas.
 */

/** The stage transform: uniform scale + translation, mapping native → screen. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const SCALE_MIN = 0.1;
export const SCALE_MAX = 8;

export function clampScale(scale: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));
}

/** Map a point from native (document) space to screen (container) pixels. */
export function nativeToScreen(p: Point, view: View): Point {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

/** Map a point from screen (container) pixels back to native (document) space. */
export function screenToNative(p: Point, view: View): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

/**
 * Compute the view that fits `content` centred inside `container`, with optional
 * uniform padding. Degenerate inputs (zero/negative dimensions) fall back to the
 * identity view so the caller never divides by zero.
 */
export function fitView(content: Size, container: Size, padding = 24): View {
  if (
    content.width <= 0 ||
    content.height <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return { scale: 1, x: 0, y: 0 };
  }
  const scale = clampScale(
    Math.min(
      (container.width - padding * 2) / content.width,
      (container.height - padding * 2) / content.height,
    ),
  );
  return {
    scale,
    x: (container.width - content.width * scale) / 2,
    y: (container.height - content.height * scale) / 2,
  };
}

/**
 * Zoom by `factor` about a fixed screen-space `focal` point (wheel-zoom-to-cursor).
 * The native point under `focal` stays put after the zoom. Scale is clamped, so
 * at the limits the view is returned effectively unchanged.
 */
export function zoomAt(view: View, focal: Point, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const native = screenToNative(focal, view);
  return {
    scale,
    x: focal.x - native.x * scale,
    y: focal.y - native.y * scale,
  };
}
