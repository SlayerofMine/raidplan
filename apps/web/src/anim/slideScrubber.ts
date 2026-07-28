import type { Stage } from "konva/lib/Stage";
import {
  layoutStepTimeline,
  resolveObjectState,
  type ObjectState,
  type PlanObject,
  type ResolvedStates,
  type Slide,
} from "@raidplan/shared";
import { applyObjectState, objectRect, readObjectState } from "./applyToStage";
import {
  collisionRules,
  isColliding,
  type CollisionRule,
  type RectLookup,
} from "./collision";
import { compileStep, type CompiledStep } from "./compileStep";
import { compileOneShot } from "./oneShot";

/**
 * **Time-addressed** playback: put a slide's objects into the exact state they
 * are in at time *t*, on a live Konva stage.
 *
 * This is the half of playback that has no transport of its own. `usePlayback`
 * (the viewer) lets GSAP run a timeline and watches it; here the caller names a
 * time and gets that frame, which is what both random-access consumers need:
 *
 *  - the **video exporter** walks `0…totalMs` at a fixed frame rate
 *    (`planFrameRenderer`), and
 *  - the **editor playhead** jumps wherever the user drags it
 *    (`useEditorPlayhead`).
 *
 * Both go through `compileStep`, the same compiler the viewer plays, so an
 * exported clip, a scrubbed frame and real playback can't diverge.
 *
 * **Collisions are simulated too.** `onCollision` animations sit outside the
 * slide timeline, so each seek re-tests the armed rules against the boxes that
 * seek just produced and starts a one-shot the first time one connects — the
 * same detection and the same `compileOneShot` playback uses. Without this a
 * picked-up orb would never disappear.
 *
 * Konva can't render under jsdom, so this layer is verified by running the app;
 * the maths it stands on (`compileStep`, `collisionRules`, `layoutStepTimeline`)
 * is unit-tested.
 */
export interface SlideScrubber {
  /**
   * Show slide `slideIndex` as it looks `timeMs` in. Returns false if there is
   * no such slide, so a caller rendering frames can bail rather than capture a
   * stale board.
   */
  seek: (slideIndex: number, timeMs: number) => boolean;
  /** How long that slide plays for, in ms — the scrub range. */
  durationMs: (slideIndex: number) => number;
  /** Put the board back the way we found it, and drop the timelines. */
  restore: (slideIndex: number) => void;
}

/** A collision animation that has fired, and when, so it can be seeked. */
interface FiredShot {
  timeline: gsap.core.Timeline;
  startedMs: number;
}

export function createSlideScrubber(params: {
  stage: Stage;
  slides: readonly Slide[];
  objects: Record<string, PlanObject>;
  objectIds: readonly string[];
}): SlideScrubber {
  const { stage, slides, objects, objectIds } = params;

  const resolveAll = (index: number): ResolvedStates => {
    const states: ResolvedStates = {};
    for (const id of objectIds) {
      const object = objects[id];
      if (object) states[id] = resolveObjectState(object, slides, index);
    }
    return states;
  };

  const applyStates = (states: ResolvedStates) => {
    for (const [id, state] of Object.entries(states)) {
      applyObjectState(stage, id, state);
    }
  };

  const apply = (objectId: string, props: Partial<ObjectState>) =>
    applyObjectState(stage, objectId, props);
  const rectOf: RectLookup = (objectId) => objectRect(stage, objectId);

  const compiled = new Map<number, CompiledStep>();
  const timelineFor = (slideIndex: number): CompiledStep | null => {
    const cached = compiled.get(slideIndex);
    if (cached) return cached;
    const slide = slides[slideIndex];
    if (!slide) return null;
    const built = compileStep({
      slide,
      states: resolveAll(slideIndex),
      apply,
    });
    compiled.set(slideIndex, built);
    return built;
  };

  // Entering a slide snaps to its start state, exactly as playback does — so a
  // frame never inherits stale attributes from the previous slide.
  let currentSlide: number | null = null;
  let lastTimeMs = 0;
  let rules: CollisionRule[] = [];
  let fired = new Set<string>();
  let shots: FiredShot[] = [];

  const killShots = () => {
    for (const shot of shots) shot.timeline.kill();
    shots = [];
  };

  /** Start any collision that has just connected, once each (a pickup is consumed). */
  const fireNewCollisions = (
    slide: Slide,
    slideIndex: number,
    timeMs: number,
  ) => {
    for (const rule of rules) {
      if (fired.has(rule.animId)) continue;
      if (!isColliding(rule, rectOf)) continue;

      const anim = slide.animations.find((a) => a.id === rule.animId);
      const here = resolveAll(slideIndex);
      const target = anim && here[anim.objectId];
      if (!anim || !target) continue;

      fired.add(rule.animId);
      const built = compileOneShot({
        anim,
        slide,
        states: {
          ...here,
          [anim.objectId]: readObjectState(stage, anim.objectId, target),
        },
        apply,
      });
      applyStates(built.initial);
      shots.push({ timeline: built.timeline, startedMs: timeMs });
    }
  };

  /**
   * Re-arm the slide: put it back to its opening instant, in every sense.
   *
   * Done on entering a slide, and on any **backwards** seek. A one-shot writes
   * properties the slide timeline never touches — `disappear` leaves an object
   * at opacity 0 — so simply seeking back past the moment of contact would drag
   * that along and the orb would stay gone. Scrubbing back therefore rewinds the
   * collision state wholesale; contact that is still true at the new time fires
   * again on this very seek, so the board stays a function of the playhead
   * rather than of the route the playhead took to get there.
   *
   * **The timeline is wound back to 0 as well, and this is load-bearing.**
   * Snapping the nodes to `initial` overwrites whatever the tweens last drew, so
   * something has to draw them again — and GSAP only redraws a tween whose
   * progress actually changed. Between two instants inside a pause (one leg of a
   * drawn move finished, the next not yet started) nothing has changed, so
   * nothing is redrawn, and the object was left sitting at the layout `initial`
   * had just stamped on it: back at its starting point, and staying there until
   * the playhead reached a segment that was mid-tween again. Parking at 0 makes
   * the seek that follows a replay from the top, where every tween the playhead
   * has passed necessarily changes progress and so necessarily redraws.
   *
   * Events are suppressed on the way back but not on the way forward, so an
   * instant effect's callback (`appear`, `disappear`) fires once, in the
   * direction the author wrote it, rather than twice or backwards.
   */
  const rearm = (slide: Slide, built: CompiledStep) => {
    killShots();
    fired = new Set();
    rules = collisionRules(slide.animations);
    applyStates(built.initial);
    built.timeline.seek(0, true);
  };

  return {
    durationMs: (slideIndex) => {
      const slide = slides[slideIndex];
      return slide ? layoutStepTimeline(slide.animations).totalMs : 0;
    },

    seek: (slideIndex, timeMs) => {
      const built = timelineFor(slideIndex);
      const slide = slides[slideIndex];
      if (!built || !slide) return false;

      if (currentSlide !== slideIndex || timeMs < lastTimeMs) {
        currentSlide = slideIndex;
        rearm(slide, built);
      }
      lastTimeMs = timeMs;

      // `false` = don't suppress events, so `disappear`'s callback actually runs.
      built.timeline.seek(timeMs / 1000, false);

      // Test collisions against the positions this seek just produced...
      fireNewCollisions(slide, slideIndex, timeMs);
      // ...then let anything already firing advance. Applied after the slide
      // timeline so a triggered effect wins over the motion underneath it.
      for (const shot of shots) {
        shot.timeline.seek(
          Math.max(0, (timeMs - shot.startedMs) / 1000),
          false,
        );
      }

      stage.batchDraw();
      return true;
    },

    restore: (slideIndex) => {
      killShots();
      for (const built of compiled.values()) built.timeline.kill();
      compiled.clear();
      currentSlide = null;
      lastTimeMs = 0;
      fired = new Set();
      rules = [];
      applyStates(resolveAll(slideIndex));
      stage.batchDraw();
    },
  };
}
