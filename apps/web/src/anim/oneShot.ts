import type {
  Anim,
  ObjectState,
  ResolvedStates,
  Slide,
} from "@raidplan/shared";
import { compileStep, type CompiledStep } from "./compileStep";

/**
 * Play **one** animation on demand (plan §7).
 *
 * Deferred triggers — `onClick`, `onCollision` — are excluded from the slide's
 * timeline, so something has to run them individually when they fire. Rather
 * than a second tween engine, this reuses `compileStep` with a synthetic
 * one-animation slide: the trigger is normalised to `onEnter` and the delay
 * dropped, because "when it fires" has already been decided by the click or the
 * collision. Every effect therefore behaves identically whether it was reached
 * by the timeline or by a trigger.
 */
export interface OneShotParams {
  anim: Anim;
  /** The slide it belongs to — supplies the surrounding context to `compileStep`. */
  slide: Slide;
  /**
   * Where the animated object is *right now*. Playback passes the object's live
   * node state, so a triggered animation continues from where the object
   * actually is rather than snapping back to the slide's opening layout — which
   * is the whole point of a trigger that fires mid-slide.
   */
  states: ResolvedStates;
  apply: (objectId: string, props: Partial<ObjectState>) => void;
  onUpdate?: () => void;
}

export function compileOneShot({
  anim,
  slide,
  states,
  apply,
  onUpdate,
}: OneShotParams): CompiledStep {
  return compileStep({
    slide: {
      ...slide,
      animations: [{ ...anim, trigger: "onEnter", delayMs: 0 }],
    },
    states,
    apply,
    ...(onUpdate ? { onUpdate } : {}),
  });
}

/** The deferred animations on a slide for one object, in document order. */
export function deferredAnimsFor(
  slide: Slide | undefined,
  objectId: string,
  trigger: Anim["trigger"],
): Anim[] {
  return (slide?.animations ?? []).filter(
    (a) => a.objectId === objectId && a.trigger === trigger,
  );
}
