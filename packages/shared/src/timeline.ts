import type { AnimEffect, AnimKind, AnimTrigger } from "./effects.js";
import type { Anim } from "./plan.js";

/**
 * The **pure timing model** of a step (plan §7 "Playback engine").
 *
 * This is the single source of truth for *when* each animation starts and how
 * long it occupies a step's timeline. The playback engine, the interactive
 * Timeline/Gantt view and `expandPlan` (which flattens an attack's internal
 * chain onto its host step) all consume it, so a bar drawn in the Gantt is
 * guaranteed to line up with the frame the player produces — there is no second
 * implementation of the trigger rules to drift out of sync (the web suite's
 * `stepTimeline.test.ts` golden cross-check pins this against real GSAP).
 *
 * It lives here rather than beside the player because it is a property of the
 * *document*: given a step's animations, the answer is the same everywhere, with
 * no GSAP, DOM or canvas involved. Everything is in **milliseconds** — the
 * document's native unit (`Anim.delayMs` / `Anim.durationMs`).
 */

const MS = 1000;

/** Effects that play out-and-back (swell→settle, blink off→on). */
function isOutAndBack(effect: AnimEffect): boolean {
  return effect === "pulse" || effect === "blink";
}

/**
 * How long an animation *reserves* on the chain — what a following
 * `afterPrevious`/`withPrevious` animation anchors against.
 *
 * This is deliberately **not** the animation's visual length: pulse/blink render
 * their out-and-back within a single `durationMs` (two half-duration tweens) but
 * reserve twice that on the chain, exactly as the player has always done
 * (`compileStep.ts`). Keeping the two quantities separate is what lets the Gantt
 * draw a bar of the real visual length while every following bar still lands on
 * the very frame playback puts it — the gap a trailing pulse leaves is shown
 * faithfully, not invented or hidden.
 */
export function occupiedMs(effect: AnimEffect, durationMs: number): number {
  return isOutAndBack(effect) ? durationMs * 2 : durationMs;
}

/**
 * **Deferred** triggers sit outside the step's auto-playing timeline and are
 * fired on demand during playback: `onClick` when the object is clicked,
 * `onCollision` when it overlaps one of its `collideWith` objects. They take no
 * position in the chain and don't extend the step's length.
 */
export function isDeferredTrigger(trigger: AnimTrigger): boolean {
  return trigger === "onClick" || trigger === "onCollision";
}

/** One animation placed on a step's timeline. All fields are milliseconds. */
export interface AnimSpan {
  animId: string;
  objectId: string;
  kind: AnimKind;
  effect: AnimEffect;
  trigger: AnimTrigger;
  /**
   * Where this animation's trigger anchors it, *before* its own delay:
   * `onEnter` → 0, `withPrevious` → previous start, `afterPrevious` → previous
   * end. Deferred triggers are anchored at the previous end for display only.
   */
  triggerMs: number;
  /** The animation's own `delayMs`. */
  delayMs: number;
  /** When the tween actually begins: `triggerMs + delayMs`. */
  startMs: number;
  /** The animation's own `durationMs`. */
  durationMs: number;
  /**
   * The bar's visual length = `durationMs`. Pulse/blink play their out-and-back
   * within this; they *reserve* more on the chain (see {@link occupiedMs}), which
   * shows as a gap before the next bar rather than a longer bar.
   */
  spanMs: number;
  /** `startMs + spanMs` — the visual end of the bar. */
  endMs: number;
  /**
   * Fired on demand rather than by the step's timeline (`onClick` /
   * `onCollision`) — see {@link isDeferredTrigger}.
   */
  deferred: boolean;
}

export interface StepTimeline {
  /** Spans in document order (the order the player chains them in). */
  spans: AnimSpan[];
  /** Total auto-playing length of the step — the max end of non-click spans. */
  totalMs: number;
}

/** Where an animation anchors, before its own delay. Milliseconds. */
function triggerMs(
  trigger: AnimTrigger,
  previousStart: number,
  previousEnd: number,
): number {
  switch (trigger) {
    case "onEnter":
      return 0;
    case "withPrevious":
      return previousStart;
    default:
      // afterPrevious, and the deferred triggers (display-only), anchor at the
      // previous end.
      return previousEnd;
  }
}

/**
 * Lay out a step's animations on its timeline.
 *
 * Mirrors `compileStep.ts` exactly: animations chain in document order, each
 * `delayMs` stacks on top of the trigger anchor, and deferred animations are
 * excluded from the chain and from `totalMs` (they're still returned, so the
 * Gantt can show them, but flagged `deferred`).
 */
export function layoutStepTimeline(animations: readonly Anim[]): StepTimeline {
  const spans: AnimSpan[] = [];
  let previousStart = 0;
  let previousEnd = 0;
  let totalMs = 0;

  for (const anim of animations) {
    const deferred = isDeferredTrigger(anim.trigger);
    const anchor = triggerMs(anim.trigger, previousStart, previousEnd);
    const startMs = anchor + anim.delayMs;
    const spanMs = anim.durationMs; // visual bar length (actual tween extent)
    const endMs = startMs + spanMs;

    spans.push({
      animId: anim.id,
      objectId: anim.objectId,
      kind: anim.kind,
      effect: anim.effect,
      trigger: anim.trigger,
      triggerMs: anchor,
      delayMs: anim.delayMs,
      startMs,
      durationMs: anim.durationMs,
      spanMs,
      endMs,
      deferred,
    });

    // Deferred animations don't participate in the auto-playing chain.
    if (!deferred) {
      previousStart = startMs;
      // The chain reserves the out-and-back length; `totalMs` (the GSAP
      // timeline's real length) tracks actual tween extents instead.
      previousEnd = startMs + occupiedMs(anim.effect, anim.durationMs);
      totalMs = Math.max(totalMs, endMs);
    }
  }

  return { spans, totalMs };
}

/** The playing length of a step, in seconds (what a GSAP timeline reports). */
export function stepDurationSeconds(animations: readonly Anim[]): number {
  return layoutStepTimeline(animations).totalMs / MS;
}
