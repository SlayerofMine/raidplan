import gsap from "gsap";
import type { Anim, ObjectState, ResolvedStates, Step } from "@raidplan/shared";
import {
  isClickTriggered as isClickTrigger,
  layoutStepTimeline,
} from "./stepTimeline";

/**
 * Compile a step into a GSAP timeline (plan §3.5 / §7 "Playback engine").
 *
 * **Deliberately renderer-agnostic.** Konva exposes `x()`/`opacity()` as
 * methods, which GSAP can't tween directly, so animations tween a plain proxy
 * object and push the values out through `apply` on every tick. That
 * indirection is what lets this compile against plain objects in tests — no
 * canvas, no DOM — while the playback hook binds `apply` to real Konva nodes
 * and a `batchDraw` (plan §8.1: never route frames through React).
 *
 * Trigger semantics (plan §7):
 *  - `onEnter`       → starts at t=0
 *  - `withPrevious`  → starts with the previous animation
 *  - `afterPrevious` → starts when the previous one ends
 *  - `onClick`       → excluded here; advanced separately by the viewer
 *
 * Each animation's `delayMs` is added on top of its trigger position.
 */
export interface CompileStepParams {
  step: Step;
  /** Object states when the step is entered (settled state of the step before). */
  start: ResolvedStates;
  /** Object states when the step has finished (this step's settled state). */
  end: ResolvedStates;
  /** Push tweened values at a target. Called on every tick. */
  apply: (objectId: string, props: ObjectState) => void;
  /** Called once per tick after all values are applied (→ `layer.batchDraw()`). */
  onUpdate?: () => void;
}

export interface CompiledStep {
  /** Paused; the caller plays, seeks or scrubs it. */
  timeline: gsap.core.Timeline;
  /**
   * The state every object must be snapped to *before* the timeline runs.
   *
   * This is the resolved start state, adjusted by any entrance effects — a
   * fade-in begins at opacity 0, a fly-in begins at its origin. Snapping to
   * this (rather than to the plain resolved start) is what stops an entering
   * object from flashing at full opacity for one frame before the first tick,
   * and it keeps jumping to a step consistent regardless of where you jump
   * from (plan §7).
   */
  initial: ResolvedStates;
}

/** Animations that are advanced by a click rather than the step timeline. */
export function isClickTriggered(anim: Anim): boolean {
  return isClickTrigger(anim.trigger);
}

const MS = 1000;
/** How far a pulse swells before settling back. */
const PULSE_SCALE = 1.15;

export function compileStep({
  step,
  start,
  end,
  apply,
  onUpdate,
}: CompileStepParams): CompiledStep {
  const timeline = gsap.timeline({ paused: true });
  if (onUpdate) timeline.eventCallback("onUpdate", onUpdate);

  // Stale animations (object deleted) must never break playback.
  const animations = step.animations.filter(
    (a) => !isClickTriggered(a) && start[a.objectId] && end[a.objectId],
  );

  const initial: ResolvedStates = {};
  for (const [id, s] of Object.entries(start)) initial[id] = { ...s };
  for (const anim of animations) {
    const from = initial[anim.objectId];
    if (from) Object.assign(from, entranceOffset(anim, from));
  }

  /**
   * One proxy per *object*, shared by all of its animations — separate proxies
   * would each push their own full state and clobber each other (e.g. a fade
   * would undo a concurrent move).
   */
  const proxies = new Map<string, ObjectState>();
  const proxyFor = (objectId: string): ObjectState => {
    let proxy = proxies.get(objectId);
    if (!proxy) {
      proxy = { ...(initial[objectId] ?? start[objectId]!) };
      proxies.set(objectId, proxy);
    }
    return proxy;
  };

  // The trigger/delay/duration math lives in one place (`stepTimeline`) so the
  // interactive Gantt view and this player can never disagree on where a bar
  // sits. `animations` is already onClick- and ghost-free, so its spans chain
  // plainly in document order.
  const spanById = new Map(
    layoutStepTimeline(animations).spans.map((s) => [s.animId, s]),
  );

  for (const anim of animations) {
    const span = spanById.get(anim.id)!;

    addTween({
      timeline,
      anim,
      proxy: proxyFor(anim.objectId),
      initial: initial[anim.objectId]!,
      end: end[anim.objectId]!,
      at: span.startMs / MS,
      duration: anim.durationMs / MS,
      apply,
    });
  }

  return { timeline, initial };
}

/**
 * How an entrance effect displaces the object before it plays: fades start
 * transparent, flies start at their origin. Non-entrance effects don't move the
 * starting point.
 */
function entranceOffset(anim: Anim, from: ObjectState): Partial<ObjectState> {
  if (anim.kind !== "entrance") return {};
  switch (anim.effect) {
    case "fade":
      return { opacity: 0, visible: true };
    case "fly":
      return {
        x: anim.params?.toX ?? from.x,
        y: anim.params?.toY ?? from.y,
        opacity: 0,
        visible: true,
      };
    case "appear":
      return { visible: false, opacity: 0 };
    default:
      return {};
  }
}

interface TweenParams {
  timeline: gsap.core.Timeline;
  anim: Anim;
  /** Shared, per-object; mutated by GSAP and pushed out on each tick. */
  proxy: ObjectState;
  initial: ObjectState;
  end: ObjectState;
  at: number;
  duration: number;
  apply: (objectId: string, props: ObjectState) => void;
}

/** Translate one (kind, effect) pair into tweens on the timeline. */
function addTween({
  timeline,
  anim,
  proxy,
  initial,
  end,
  at,
  duration,
  apply,
}: TweenParams): void {
  const push = () => apply(anim.objectId, { ...proxy });

  // `visible` is a boolean: GSAP can't tween it, so it's flipped by a callback
  // and carried out with the next push.
  const setAt = (props: Partial<ObjectState>, position: number) =>
    timeline.call(
      () => {
        Object.assign(proxy, props);
        push();
      },
      undefined,
      position,
    );

  const tweenTo = (vars: gsap.TweenVars, position = at, dur = duration) =>
    timeline.to(
      proxy,
      { duration: dur, ease: anim.easing, ...vars, onUpdate: push },
      position,
    );

  switch (anim.effect) {
    case "appear":
      setAt({ visible: true, opacity: end.opacity }, at);
      return;

    case "disappear":
      setAt({ visible: false, opacity: 0 }, at);
      return;

    case "fade":
      // The entrance's opacity-0 start is already in `initial`.
      tweenTo({
        opacity:
          anim.kind === "exit" ? 0 : (anim.params?.toOpacity ?? end.opacity),
      });
      return;

    case "fly":
      tweenTo({ x: end.x, y: end.y, opacity: end.opacity });
      return;

    case "move":
      tweenTo({
        x: anim.params?.toX ?? end.x,
        y: anim.params?.toY ?? end.y,
      });
      return;

    case "scale":
      tweenTo({ w: end.w, h: end.h });
      return;

    case "pulse": {
      // Swell about the centre, then settle back to exactly where it started.
      const dx = (initial.w * (PULSE_SCALE - 1)) / 2;
      const dy = (initial.h * (PULSE_SCALE - 1)) / 2;
      tweenTo(
        {
          w: initial.w * PULSE_SCALE,
          h: initial.h * PULSE_SCALE,
          x: initial.x - dx,
          y: initial.y - dy,
        },
        at,
        duration / 2,
      );
      tweenTo(
        { w: initial.w, h: initial.h, x: initial.x, y: initial.y },
        at + duration / 2,
        duration / 2,
      );
      return;
    }

    case "blink":
      tweenTo({ opacity: 0 }, at, duration / 2);
      tweenTo({ opacity: initial.opacity }, at + duration / 2, duration / 2);
      return;

    default:
      return;
  }
}
