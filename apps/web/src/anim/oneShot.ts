import type { Anim, ObjectState, ResolvedStates, Step } from "@raidplan/shared";
import { compileStep, type CompiledStep } from "./compileStep";

/**
 * Play **one** animation on demand (plan §7).
 *
 * Deferred triggers — `onClick`, `onCollision` — are excluded from the step's
 * timeline, so something has to run them individually when they fire. Rather
 * than a second tween engine, this reuses `compileStep` with a synthetic
 * one-animation step: the trigger is normalised to `onEnter` and the delay
 * dropped, because "when it fires" has already been decided by the click or the
 * collision. Every effect therefore behaves identically whether it was reached
 * by the timeline or by a trigger.
 */
export interface OneShotParams {
  anim: Anim;
  /** The step it belongs to — supplies the surrounding context to `compileStep`. */
  step: Step;
  /**
   * Where the animated object is *right now*. Playback passes the object's live
   * node state, so a triggered animation continues from where the object
   * actually is rather than snapping back to the step's start.
   */
  start: ResolvedStates;
  /** The step's settled end state, the target for effects that resolve to it. */
  end: ResolvedStates;
  apply: (objectId: string, props: ObjectState) => void;
  onUpdate?: () => void;
}

export function compileOneShot({
  anim,
  step,
  start,
  end,
  apply,
  onUpdate,
}: OneShotParams): CompiledStep {
  return compileStep({
    step: {
      ...step,
      animations: [{ ...anim, trigger: "onEnter", delayMs: 0 }],
    },
    start,
    end,
    apply,
    ...(onUpdate ? { onUpdate } : {}),
  });
}

/** The deferred animations on a step for one object, in document order. */
export function deferredAnimsFor(
  step: Step | undefined,
  objectId: string,
  trigger: Anim["trigger"],
): Anim[] {
  return (step?.animations ?? []).filter(
    (a) => a.objectId === objectId && a.trigger === trigger,
  );
}
