import type { AnimSpan } from "@raidplan/shared";

/**
 * The Timeline's **geometry** — everything about drawing and dragging a Gantt
 * bar, and nothing about when an animation runs.
 *
 * The timing model itself (`layoutStepTimeline`, `occupiedMs`,
 * `isDeferredTrigger`) is a property of the document and lives in
 * `@raidplan/shared`, where the player, this chart and `expandPlan` all read the
 * same answer. What's left here is pixels: lane packing, the ms↔px mapping, and
 * the snap rules for dragging — UI concerns that have no business in the
 * document contract.
 */

/**
 * Pack a single object's spans into non-overlapping horizontal lanes so
 * concurrent animations (e.g. a move + a fade `withPrevious`) don't draw on top
 * of each other. Greedy first-fit by start position; returns each span's lane
 * and the total lane count. Pure — the row height is derived from `laneCount`.
 */
export function packLanes(spans: readonly AnimSpan[]): {
  lane: Map<string, number>;
  laneCount: number;
} {
  const ordered = [...spans].sort((a, b) => a.triggerMs - b.triggerMs);
  const laneEnds: number[] = [];
  const lane = new Map<string, number>();

  for (const span of ordered) {
    let placed = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (span.triggerMs >= laneEnds[i]!) {
        placed = i;
        break;
      }
    }
    if (placed === -1) {
      placed = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[placed] = span.endMs;
    lane.set(span.animId, placed);
  }

  return { lane, laneCount: Math.max(1, laneEnds.length) };
}

// --- pixel <-> millisecond mapping (the Gantt's interactive geometry) --------

/** Grid the Timeline snaps drags and nudges to (matches the panel's ms step). */
export const TIMELINE_SNAP_MS = 50;

/** A horizontal scale for one chart: how many pixels a millisecond occupies. */
export interface TimelineScale {
  pxPerMs: number;
  /** The timeline length the chart is drawn against (never shorter than the min). */
  contentMs: number;
}

/**
 * Fit `totalMs` into `widthPx`, reserving `padRightPx` so the last bar's resize
 * handle stays grabbable, and never collapsing below `minSpanMs` so a short or
 * empty step still shows a sensible axis. Returns `pxPerMs = 0` before the
 * container has been measured (width 0), which harmlessly gives zero-width bars.
 */
export function timelineScale(
  widthPx: number,
  totalMs: number,
  opts: { minSpanMs?: number; padRightPx?: number } = {},
): TimelineScale {
  const { minSpanMs = 1000, padRightPx = 24 } = opts;
  const contentMs = Math.max(totalMs, minSpanMs);
  const usable = Math.max(0, widthPx - padRightPx);
  return { pxPerMs: usable > 0 ? usable / contentMs : 0, contentMs };
}

export function msToPx(ms: number, pxPerMs: number): number {
  return ms * pxPerMs;
}

export function pxToMs(px: number, pxPerMs: number): number {
  return pxPerMs > 0 ? px / pxPerMs : 0;
}

/** Round to the snap grid. */
export function snapMs(ms: number, snap: number = TIMELINE_SNAP_MS): number {
  return snap > 0 ? Math.round(ms / snap) * snap : ms;
}

/**
 * New millisecond value after dragging a bar by `deltaPx` from `startMs`,
 * snapped to the grid and floored at `min`. Used for both delay (drag the body)
 * and duration (drag the right handle).
 */
export function dragValueMs(
  startMs: number,
  deltaPx: number,
  pxPerMs: number,
  min = 0,
  snap: number = TIMELINE_SNAP_MS,
): number {
  return Math.max(min, snapMs(startMs + pxToMs(deltaPx, pxPerMs), snap));
}

/**
 * New millisecond value after a keyboard nudge of `steps` grid increments
 * (negative to shrink), floored at `min`. Keyboard editing needs no pixel scale,
 * which is what keeps the Timeline operable without a mouse — and testable in
 * jsdom, where nothing has a measured width.
 */
export function nudgeValueMs(
  startMs: number,
  steps: number,
  min = 0,
  snap: number = TIMELINE_SNAP_MS,
): number {
  return Math.max(min, snapMs(startMs + steps * snap, snap));
}
