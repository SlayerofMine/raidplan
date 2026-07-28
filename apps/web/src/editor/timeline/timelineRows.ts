import type { AnimSpan } from "@raidplan/shared";

/**
 * What a Timeline row and a Timeline bar *stand for* (plan §18.1 / §3.4).
 *
 * A group is a claim that some objects are one thing, and the timeline has to
 * say the same: animating a group of six is one decision, so it gets one row
 * and — while the six agree about their timing — one bar, not six identical
 * bars stacked six rows deep. This is the same collapse the Animation panel
 * already makes for a selection, applied to the chart.
 *
 * Pure and pixel-free, so the rules can be tested without a layout engine; the
 * geometry lives next door in `anim/stepTimeline.ts`.
 */

/** One drawn bar, and every animation it retimes when dragged. */
export interface TimelineBar {
  /**
   * The animations this bar is. More than one only when a group moves as one —
   * dragging it patches all of them, in a single action (`updateAnimations`).
   */
  animIds: string[];
  /** The span the bar is drawn from; every animation in it agrees with this. */
  span: AnimSpan;
  /** Objects covered — 1 for an ordinary bar, N for a group moving as one. */
  objectCount: number;
}

/** One labelled line of the chart: an object, or a group standing for its members. */
export interface TimelineRow {
  kind: "object" | "group";
  /** Object id, or group id — whichever the row stands for. */
  id: string;
  /** What clicking the row's label selects, in first-appearance order. */
  objectIds: string[];
  bars: TimelineBar[];
}

/**
 * What makes two spans "the same thing happening", ignoring which object it
 * happens to. Only timing and identity of the effect: those are exactly what a
 * bar draws and what dragging it changes, so a bar can only exist while its
 * animations agree about all of it. Change one member's delay and its bar
 * splits out of the group's — which is what you want to see.
 */
function signatureOf(span: AnimSpan): string {
  return JSON.stringify([
    span.kind,
    span.effect,
    span.trigger,
    span.triggerMs,
    span.delayMs,
    span.durationMs,
    span.deferred,
  ]);
}

/**
 * Build the chart's rows from a slide's spans, in first-appearance order.
 *
 * `groupOf` answers which group an object belongs to — `undefined` for the
 * ungrouped, and the caller is the one that decides whether a group is real
 * (a group exists only at two members or more, plan §18.1).
 *
 * Two animations on the **same** object never share a bar, even when identical:
 * they are separate things that happen to look alike, and merging them would
 * make one of them impossible to retime on its own. That is the same rule the
 * Animation panel's rows follow, and it also means an object row — which has
 * only one object in it — never merges anything.
 */
export function buildTimelineRows(
  spans: readonly AnimSpan[],
  groupOf: (objectId: string) => string | undefined,
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const byKey = new Map<string, TimelineRow>();
  // Bars of a row, by signature — with an occurrence suffix so the second
  // identical animation of one object starts a second bar rather than joining
  // the first.
  const barsBySignature = new Map<
    string,
    { bar: TimelineBar; objectIds: Set<string> }
  >();

  for (const span of spans) {
    const groupId = groupOf(span.objectId);
    const rowKey = groupId ?? span.objectId;

    let row = byKey.get(rowKey);
    if (!row) {
      row = {
        kind: groupId ? "group" : "object",
        id: rowKey,
        objectIds: [],
        bars: [],
      };
      byKey.set(rowKey, row);
      rows.push(row);
    }
    if (!row.objectIds.includes(span.objectId))
      row.objectIds.push(span.objectId);

    const signature = signatureOf(span);
    let occurrence = 0;
    let barKey = `${rowKey} ${signature}#0`;
    while (barsBySignature.get(barKey)?.objectIds.has(span.objectId)) {
      barKey = `${rowKey} ${signature}#${++occurrence}`;
    }

    const existing = barsBySignature.get(barKey);
    if (existing) {
      existing.bar.animIds.push(span.animId);
      existing.objectIds.add(span.objectId);
      existing.bar.objectCount = existing.objectIds.size;
    } else {
      const bar: TimelineBar = {
        animIds: [span.animId],
        span,
        objectCount: 1,
      };
      barsBySignature.set(barKey, { bar, objectIds: new Set([span.objectId]) });
      row.bars.push(bar);
    }
  }

  return rows;
}
