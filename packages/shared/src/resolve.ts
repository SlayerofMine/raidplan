import type { Anim, Plan, PlanObject, Slide, SlideState } from "./plan.js";
import { centrePoint, topLeftForCentre } from "./transform.js";

/**
 * State resolution (plan §5 "State resolution" / §7 playback).
 *
 * The model is **PowerPoint with Morph**: a plan is an ordered list of slides,
 * each holding a *complete* layout, and playback morphs slide n-1's layout into
 * slide n's. Kept as a pure, deterministic function so it is trivially testable
 * and shared identically by the editor (which edits a slide's layout) and the
 * viewer (which animates *previous → this*).
 *
 * A slide's `states` is **where it opens**: every object in the scene, in the
 * position it holds when the slide begins. The slide's animations then play from
 * there, each stating its own target (see {@link ./plan.js AnimParamsSchema}).
 * Nothing is inherited, folded or accumulated, and nothing is read from a
 * neighbouring slide — so every slide, including the first, plays the same way,
 * and there is no slide whose animations mean something different.
 *
 * This is deliberately *not* PowerPoint's Morph. Under a morph a `move` is the
 * difference between two slides' layouts, which means it can only exist where
 * there is a slide before it to differ from, and the same drag edits both a
 * layout and an animation. Here a move is a journey the author draws: it has a
 * start (where the object is), corners, and an end, and it says all three
 * itself.
 *
 * **A slide owns its cast.** `slide.states` is the membership list as well as
 * the layout: an object is *on* a slide precisely when it has an entry there.
 * Adding a token while writing slide 3 puts it on slide 3 and nowhere else, and
 * an object can leave a slide without leaving the plan. `plan.objects` is only
 * the registry the slides draw from — it says what a thing *is* (icon, tint,
 * style, what it follows), never where or whether it appears.
 *
 * That identity has to stay plan-level, because a `move` is one object seen on
 * two slides: give each slide its own copy of the definition and there is
 * nothing left to say "this is the same token" with, so nothing could animate
 * between slides at all.
 *
 * This replaced a `base` transform plus *sparse, cascading* step overrides.
 * Under that model an absent field carried the previous step's value forward,
 * which meant editing step 2 silently moved the object on steps 3..n — the
 * confusion slides exist to remove. Nothing inherits any more, and an entry is
 * either complete or not there at all (see {@link normalizeSlides}).
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
 * Only for minting a slide entry, and as the last-resort stand-in for an object
 * no slide has. Never call it to find out where something is: that is what the
 * slide says, and `object.base`'s transform fields go stale the moment the
 * object is first moved.
 */
export function seedState(object: PlanObject): ObjectState {
  const { x, y, w, h, rotation, opacity, visible } = object.base;
  return { x, y, w, h, rotation, opacity, visible };
}

/** Is `objectId` part of slide `slideIndex`'s cast? */
export function isOnSlide(
  slides: readonly Slide[],
  slideIndex: number,
  objectId: string,
): boolean {
  return slides[slideIndex]?.states[objectId] !== undefined;
}

/**
 * Of `objectIds`, the ones on slide `slideIndex` — in the order given, so the
 * caller's z-order survives.
 */
export function objectsOnSlide(
  objectIds: readonly string[],
  slides: readonly Slide[],
  slideIndex: number,
): string[] {
  const states = slides[slideIndex]?.states;
  if (!states) return [];
  return objectIds.filter((id) => states[id] !== undefined);
}

/**
 * Resolve **one** object's state on slide `slideIndex` — a plain lookup when the
 * object is on that slide.
 *
 * Takes the slides array rather than a `Plan` so callers holding objects in a
 * normalized map (the editor store) can resolve a single object without
 * rebuilding a `Plan` or resolving all 50 of them, which keeps per-object store
 * subscriptions cheap (plan §8.2). `slideIndex` is clamped, so asking for "the
 * final state" with a large index is safe.
 *
 * An object that is **not on the slide** resolves to `visible: false` — which is
 * what "not in this scene" means to every renderer, none of which needs to learn
 * a second way of saying it. Its geometry is borrowed from the nearest slide
 * that *does* have it (looking back first, then forward), so a token that
 * appears on slide 3 fades in where it belongs rather than sliding in from
 * wherever it happened to be created.
 */
export function resolveObjectState(
  object: PlanObject,
  slides: readonly Slide[],
  slideIndex: number,
): ObjectState {
  if (slides.length === 0) return { ...seedState(object), visible: false };
  const index = Math.min(Math.max(slideIndex, 0), slides.length - 1);
  const state = slides[index]?.states[object.id];
  if (state) return { ...state };
  return { ...nearestState(object, slides, index), visible: false };
}

/**
 * The geometry to stand in with while an object is off-slide: the closest slide
 * that has it, preferring the past — an object usually leaves a scene where it
 * last stood — and falling back to its creation seed if no slide has it at all.
 */
function nearestState(
  object: PlanObject,
  slides: readonly Slide[],
  index: number,
): ObjectState {
  for (let i = index - 1; i >= 0; i--) {
    const state = slides[i]?.states[object.id];
    if (state) return state;
  }
  for (let i = index + 1; i < slides.length; i++) {
    const state = slides[i]?.states[object.id];
    if (state) return state;
  }
  return seedState(object);
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

/**
 * Where one object is left standing once a slide has finished playing — its
 * opening state, with the slide's animations applied in order.
 *
 * A cheap paper evaluation of the timeline, not the timeline itself: playback
 * runs real GSAP tweens and this only needs their *result*. Two things want that
 * result and neither can afford a renderer — the editor, answering "and then?"
 * when a slide is continued (it would otherwise carry forward a layout the slide
 * had already animated away from), and a still image of a slide, which should
 * show the slide as it ends rather than frozen before anything happens.
 *
 * Deferred animations are skipped: a click or a collision may never happen, so
 * folding one in would state an outcome the slide does not promise.
 */
export function settledState(
  state: ObjectState,
  animations: readonly Anim[],
  objectId: string,
): ObjectState {
  let out = state;
  for (const anim of animations) {
    if (anim.objectId !== objectId) continue;
    if (anim.trigger === "onClick" || anim.trigger === "onCollision") continue;
    out = { ...out, ...effectResult(anim, out) };
  }
  return out;
}

/** What one animation leaves behind, given where the object stood before it. */
function effectResult(anim: Anim, from: ObjectState): Partial<ObjectState> {
  const params = anim.params ?? {};
  switch (anim.effect) {
    case "move":
      return { x: params.toX ?? from.x, y: params.toY ?? from.y };
    case "fly":
      // Flies *in* to where it already is; the journey is the only difference.
      return { visible: true, opacity: from.opacity };
    case "appear":
      return { visible: true };
    case "disappear":
      return { visible: false, opacity: 0 };
    case "fade":
      return anim.kind === "exit"
        ? { opacity: 0 }
        : { visible: true, opacity: params.toOpacity ?? from.opacity };
    case "scale": {
      // Grows about its own middle. Via `topLeftForCentre` rather than half the
      // growth off the corner, because a box turns about its top-left: on a
      // rotated object the growth runs along the turned axes, and the same
      // reasoning (and the same helpers) drive it during playback.
      const factor = params.scale ?? 1;
      const grown = { ...from, w: from.w * factor, h: from.h * factor };
      return { ...grown, ...topLeftForCentre(grown, centrePoint(from)) };
    }
    // Pulse and blink return to exactly where they started.
    default:
      return {};
  }
}

/**
 * Where an object stands **when `animId` is about to play** — the slide's
 * opening state with every earlier animation of that object folded in.
 *
 * This is what makes a chain of moves mean what it looks like. A `move` states
 * its own journey, and the journey starts where the object *is by then*, not
 * where the slide opened: draw "in, wait, out" as three moves and the second
 * begins where the first left off, rather than snapping back to the start.
 *
 * Same paper evaluation as {@link settledState} — indeed it is that function
 * over the preceding animations — so the editor's route overlay, the playback
 * compiler and the still renderer all get the same answer from one rule.
 *
 * An unknown (or absent) `animId` means "after everything", which is the answer
 * a *new* animation appended to the slide wants.
 */
export function stateBeforeAnim(
  state: ObjectState,
  animations: readonly Anim[],
  objectId: string,
  animId?: string,
): ObjectState {
  const index = animId ? animations.findIndex((a) => a.id === animId) : -1;
  return settledState(
    state,
    index < 0 ? animations : animations.slice(0, index),
    objectId,
  );
}

/** Every object's state once `slide` has played out. */
export function settledStates(slide: Slide): Record<string, SlideState> {
  const out: Record<string, SlideState> = {};
  for (const [id, state] of Object.entries(slide.states)) {
    out[id] = settledState(state, slide.animations, id);
  }
  return out;
}

/**
 * Every object's state at the *end* of slide `slideIndex` — what a still image
 * of that slide should show. See {@link settledState}.
 */
export function resolveSettledStates(
  plan: Plan,
  slideIndex: number,
): ResolvedStates {
  const index = Math.min(Math.max(slideIndex, 0), plan.slides.length - 1);
  const slide = plan.slides[index];
  const states = resolveSlideStates(plan, index);
  if (!slide) return states;
  for (const [id, state] of Object.entries(states)) {
    states[id] = settledState(state, slide.animations, id);
  }
  return states;
}

/**
 * Drop slide entries and animations for objects the plan no longer has.
 *
 * A slide's `states` is its cast list, so a *missing* entry is not damage —
 * it means the object isn't in that scene, and filling it in would put things
 * back on slides the author took them off. Only the other direction is repaired:
 * an entry naming an object that isn't in `objects` can't be drawn, would
 * resurrect on undo, and bloats every save. Animations on a vanished object go
 * with it, for the same reason.
 *
 * Pure and idempotent — running it twice changes nothing — so it is safe to call
 * on every load. Returns new slides only where something was actually dropped,
 * so an already-clean document keeps its references (and the store's
 * `sameDocument` reference check stays honest).
 */
export function normalizeSlides(
  objects: readonly PlanObject[],
  slides: readonly Slide[],
): Slide[] {
  const known = new Set(objects.map((object) => object.id));
  return slides.map((slide) => {
    const entries = Object.entries(slide.states).filter(([id]) =>
      known.has(id),
    );
    const animations = slide.animations.filter((a) => known.has(a.objectId));
    if (
      entries.length === Object.keys(slide.states).length &&
      animations.length === slide.animations.length
    ) {
      return slide;
    }
    return {
      ...slide,
      states: Object.fromEntries(entries) as Record<string, SlideState>,
      animations,
    };
  });
}
