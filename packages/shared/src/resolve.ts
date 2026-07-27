import type { Plan, PlanObject, Slide, SlideState } from "./plan.js";

/**
 * State resolution (plan §5 "State resolution" / §7 playback).
 *
 * The model is **PowerPoint with Morph**: a plan is an ordered list of slides,
 * each holding a *complete* layout, and playback morphs slide n-1's layout into
 * slide n's. Kept as a pure, deterministic function so it is trivially testable
 * and shared identically by the editor (which edits a slide's layout) and the
 * viewer (which animates *previous → this*).
 *
 * Terminology:
 *  - **slide state(n)** — where objects sit once slide `n` has settled. Read
 *    straight off the slide; nothing is inherited, folded or accumulated.
 *  - **start state(n)** — where objects sit when the slide is *entered*
 *    = slide state(n-1), except on slide 0.
 *  - **end state(n)**   — slide state(n).
 *
 * **Slide 0 is static**: it is the opening layout and has nothing before it, so
 * `start(0) === end(0)`. Entrances and emphasis play there; a `move` has nowhere
 * to move from, and authoring one means adding a slide before it.
 *
 * This replaced a `base` transform plus *sparse, cascading* step overrides.
 * Under that model an absent field carried the previous step's value forward,
 * which meant editing step 2 silently moved the object on steps 3..n — the
 * confusion slides exist to remove. Nothing inherits any more, which is why
 * slides are dense (see {@link normalizeSlides} for how they are kept that way).
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

/**
 * The state a *new* slide entry for this object is minted from — its creation
 * transform, off `object.base`.
 *
 * Only for minting and repair ({@link normalizeSlides}). Never call it to find
 * out where something is: that is what the slide says, and `object.base`'s
 * transform fields go stale the moment the object is first moved.
 */
export function seedState(object: PlanObject): ObjectState {
  const { x, y, w, h, rotation, opacity, visible } = object.base;
  return { x, y, w, h, rotation, opacity, visible };
}

/**
 * Resolve **one** object's state on slide `slideIndex` — a plain lookup, since
 * slides are dense.
 *
 * Takes the slides array rather than a `Plan` so callers holding objects in a
 * normalized map (the editor store) can resolve a single object without
 * rebuilding a `Plan` or resolving all 50 of them, which keeps per-object store
 * subscriptions cheap (plan §8.2). `slideIndex` is clamped, so asking for "the
 * final state" with a large index is safe.
 *
 * Falls back to the object's seed if the slide has no entry for it. That should
 * not happen — {@link normalizeSlides} runs on load and the store maintains the
 * invariant on every structural edit — but a missing entry must degrade to a
 * visible object in a plausible place, never to a crash during playback.
 */
export function resolveObjectState(
  object: PlanObject,
  slides: readonly Slide[],
  slideIndex: number,
): ObjectState {
  if (slides.length === 0) return seedState(object);
  const index = Math.min(Math.max(slideIndex, 0), slides.length - 1);
  const state = slides[index]?.states[object.id];
  return state ? { ...state } : seedState(object);
}

/** Resolve the state of every object on slide `slideIndex`. */
export function resolveSlideStates(
  plan: Plan,
  slideIndex: number,
): ResolvedStates {
  const states: ResolvedStates = {};
  for (const object of plan.objects) {
    states[object.id] = resolveObjectState(object, plan.slides, slideIndex);
  }
  return states;
}

/** The start and end states the viewer animates between for a given slide. */
export interface SlideStates {
  /** Where objects sit when the slide is entered (the previous slide's layout). */
  start: ResolvedStates;
  /** Where objects settle when the slide finishes. */
  end: ResolvedStates;
}

/**
 * Resolve the `{ start, end }` states for a single slide, by index.
 *
 * On slide 0 `start` and `end` are the same layout — there is no earlier slide
 * to come from. That is what makes the opening slide static.
 *
 * Unlike {@link resolveSlideStates} this is *strict*: `slideIndex` must be a
 * valid integer index into `plan.slides`, because animating an out-of-range
 * slide is a programming error, not a recoverable data quirk.
 *
 * @throws {RangeError} if `slideIndex` is not an integer in `[0, slides.length)`.
 */
export function resolveSlideTransition(
  plan: Plan,
  slideIndex: number,
): SlideStates {
  if (!Number.isInteger(slideIndex)) {
    throw new RangeError(`slide index must be an integer, got ${slideIndex}`);
  }
  if (slideIndex < 0 || slideIndex >= plan.slides.length) {
    throw new RangeError(
      `slide index ${slideIndex} out of range [0, ${plan.slides.length})`,
    );
  }
  return {
    start: resolveSlideStates(plan, slideIndex === 0 ? 0 : slideIndex - 1),
    end: resolveSlideStates(plan, slideIndex),
  };
}

/**
 * Restore the density invariant: every slide carries a state for every object,
 * and for nothing else.
 *
 * Dense slides are what make the model cascade-free, but density is an invariant
 * the *writer* has to maintain — and imported JSON, a hand-edited document or a
 * bug in a store action can all break it. This repairs rather than rejects: a
 * missing entry is filled from the previous slide (or the object's seed on the
 * first slide), because "it was wherever it was before" is the only answer that
 * can't teleport something; entries for objects that no longer exist are
 * dropped, exactly as a stale override used to be ignored.
 *
 * Pure and idempotent — running it twice changes nothing — so it is safe to call
 * on every load. Returns new slides only where a repair was needed, so an
 * already-valid document keeps its references (and the store's
 * `sameDocument` reference check stays honest).
 */
export function normalizeSlides(
  objects: readonly PlanObject[],
  slides: readonly Slide[],
): Slide[] {
  let previous: Record<string, SlideState> | undefined;
  return slides.map((slide) => {
    const states: Record<string, SlideState> = {};
    let changed = Object.keys(slide.states).length !== objects.length;
    for (const object of objects) {
      const state =
        slide.states[object.id] ?? previous?.[object.id] ?? seedState(object);
      if (state !== slide.states[object.id]) changed = true;
      states[object.id] = { ...state };
    }
    previous = states;
    return changed ? { ...slide, states } : slide;
  });
}
