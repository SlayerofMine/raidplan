import type { Plan, PlanObject, Step, StepOverride } from "./plan.js";

/**
 * State resolution (plan §5 "State resolution" / §7 playback).
 *
 * The model is "PowerPoint slide + animations", kept as a **pure, deterministic
 * function** so it is trivially testable and shared identically by the editor
 * (which edits the *end* state) and the viewer (which animates *start → end*).
 *
 * Terminology:
 *  - **base state**      — an object's appearance before any step (settled step -1).
 *  - **settled state(n)** — base state with the overrides of steps 0..n applied,
 *                           in order; each step's override merges over the last.
 *  - **start state(n)**   — where objects sit when the step is *entered* = settled(n-1).
 *  - **end state(n)**     — where objects settle when the step finishes = settled(n).
 *
 * Overrides are sparse: an absent field carries the previous value forward, so a
 * step that only nudges `x` leaves opacity/visibility untouched.
 */

/** The fully-resolved visual state of one object at a point in the plan. */
export interface ObjectState {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  visible: boolean;
}

/** Map of objectId → resolved state. */
export type ResolvedStates = Record<string, ObjectState>;

/** The base state of a single object (its step-independent appearance). */
export function baseState(object: PlanObject): ObjectState {
  const { x, y, w, h, rotation, opacity, visible } = object.base;
  return { x, y, w, h, rotation, opacity, visible };
}

/** Merge a sparse override over a state, returning a new state (no mutation). */
function applyOverride(
  state: ObjectState,
  override: StepOverride,
): ObjectState {
  return {
    x: override.x ?? state.x,
    y: override.y ?? state.y,
    w: override.w ?? state.w,
    h: override.h ?? state.h,
    rotation: override.rotation ?? state.rotation,
    opacity: override.opacity ?? state.opacity,
    visible: override.visible ?? state.visible,
  };
}

/**
 * Resolve **one** object's settled state after applying steps `0..stepIndex`
 * (inclusive). Pass `stepIndex = -1` for the base state.
 *
 * This is the primitive the whole model rests on. It takes the steps array
 * rather than a `Plan` so callers holding objects in a normalized map (the
 * editor store) can resolve a single object without rebuilding a `Plan` or
 * resolving all 50 of them — which keeps per-object store subscriptions cheap
 * (plan §8.2). `stepIndex` is clamped, so asking for "the final state" with a
 * large index is safe.
 */
export function resolveObjectState(
  object: PlanObject,
  steps: readonly Step[],
  stepIndex: number,
): ObjectState {
  let state = baseState(object);
  const lastStep = Math.min(stepIndex, steps.length - 1);
  for (let i = 0; i <= lastStep; i++) {
    const override = steps[i]?.overrides[object.id];
    if (override) state = applyOverride(state, override);
  }
  return state;
}

/**
 * Resolve the settled state of every object after applying steps `0..stepIndex`
 * (inclusive). Pass `stepIndex = -1` for the base state.
 *
 * Overrides that reference an object id which no longer exists (e.g. a deleted
 * object) are ignored rather than throwing — a stale override must never break
 * playback.
 */
export function resolveSettledState(
  plan: Plan,
  stepIndex: number,
): ResolvedStates {
  const states: ResolvedStates = {};
  for (const object of plan.objects) {
    states[object.id] = resolveObjectState(object, plan.steps, stepIndex);
  }
  return states;
}

/** The start and end states the viewer animates between for a given step. */
export interface StepStates {
  /** Where objects sit when the step is entered (settled state of the prior step). */
  start: ResolvedStates;
  /** Where objects settle when the step finishes. */
  end: ResolvedStates;
}

/**
 * Resolve the `{ start, end }` states for a single step, by index.
 *
 * Unlike {@link resolveSettledState} this is *strict*: `stepIndex` must be a
 * valid integer index into `plan.steps`, because animating an out-of-range step
 * is a programming error, not a recoverable data quirk.
 *
 * @throws {RangeError} if `stepIndex` is not an integer in `[0, steps.length)`.
 */
export function resolveStepStates(plan: Plan, stepIndex: number): StepStates {
  if (!Number.isInteger(stepIndex)) {
    throw new RangeError(`step index must be an integer, got ${stepIndex}`);
  }
  if (stepIndex < 0 || stepIndex >= plan.steps.length) {
    throw new RangeError(
      `step index ${stepIndex} out of range [0, ${plan.steps.length})`,
    );
  }
  return {
    start: resolveSettledState(plan, stepIndex - 1),
    end: resolveSettledState(plan, stepIndex),
  };
}
