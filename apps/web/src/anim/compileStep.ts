import gsap from "gsap";
import {
  buildMotionPath,
  isDeferredTrigger,
  samplePath,
  layoutStepTimeline,
  type Anim,
  type ObjectState,
  type ResolvedStates,
  type Slide,
} from "@raidplan/shared";

/**
 * Compile a slide into a GSAP timeline (plan §3.5 / §7 "Playback engine").
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
 *  - `onClick` / `onCollision` → excluded here; fired on demand during
 *    playback via `oneShot.ts`
 *
 * Each animation's `delayMs` is added on top of its trigger position.
 */
export interface CompileStepParams {
  slide: Slide;
  /**
   * The layout the slide **opens** on: every object in the scene, where it
   * stands before anything plays.
   *
   * One map, not a start and an end. An animation states its own target, so
   * there is nothing to look up in a neighbouring slide — which is what lets a
   * `move` mean the same thing on the first slide as on the ninth.
   */
  states: ResolvedStates;
  /**
   * Push tweened values at a target. Called on every tick, with **only the
   * properties this animation drives** — see `addTween`.
   */
  apply: (objectId: string, props: Partial<ObjectState>) => void;
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
   * and it keeps jumping to a slide consistent regardless of where you jump
   * from (plan §7).
   */
  initial: ResolvedStates;
}

/**
 * Animations fired on demand (click / collision) rather than by the slide
 * timeline. They're excluded here and played individually — see `oneShot.ts`.
 */
export function isDeferred(anim: Anim): boolean {
  return isDeferredTrigger(anim.trigger);
}

const MS = 1000;
/** How far a pulse swells before settling back. */
const PULSE_SCALE = 1.15;

export function compileStep({
  slide,
  states,
  apply,
  onUpdate,
}: CompileStepParams): CompiledStep {
  const timeline = gsap.timeline({ paused: true });
  if (onUpdate) timeline.eventCallback("onUpdate", onUpdate);

  // Stale animations (object deleted) must never break playback.
  const animations = slide.animations.filter(
    (a) => !isDeferred(a) && states[a.objectId],
  );

  const initial: ResolvedStates = {};
  for (const [id, s] of Object.entries(states)) initial[id] = { ...s };
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
      proxy = { ...(initial[objectId] ?? states[objectId]!) };
      proxies.set(objectId, proxy);
    }
    return proxy;
  };

  // The trigger/delay/duration math lives in one place (`stepTimeline`) so the
  // interactive Gantt view and this player can never disagree on where a bar
  // sits. `animations` is already deferred- and ghost-free, so its spans chain
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
      state: states[anim.objectId]!,
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
  /** Where this animation starts: the slide's layout, plus any entrance offset. */
  initial: ObjectState;
  /** The slide's own value for this object, before an entrance displaced it. */
  state: ObjectState;
  at: number;
  duration: number;
  apply: (objectId: string, props: Partial<ObjectState>) => void;
}

/** Properties of the shared proxy, as GSAP tween vars name them. */
const STATE_KEYS = [
  "x",
  "y",
  "rotation",
  "opacity",
  "visible",
  "w",
  "h",
] as const satisfies readonly (keyof ObjectState)[];

/**
 * Translate one (kind, effect) pair into tweens on the timeline.
 *
 * Every push carries **only the properties this animation drives**. Objects
 * share one proxy, and a triggered animation — a collision's disappear, say —
 * can be running on the same object as a slide's move; if each pushed the whole
 * state, whichever ticked last that frame would silently undo the other. That
 * is not hypothetical: it made every `onCollision` on a moving object look dead,
 * because the move re-asserted `visible: true` a frame after the disappear.
 */
function addTween({
  timeline,
  anim,
  proxy,
  initial,
  state,
  at,
  duration,
  apply,
}: TweenParams): void {
  const push = (keys: readonly (keyof ObjectState)[]) => {
    const patch: Partial<ObjectState> = {};
    for (const key of keys) patch[key] = proxy[key] as never;
    apply(anim.objectId, patch);
  };

  // `visible` is a boolean: GSAP can't tween it, so it's flipped by a callback
  // and carried out with the next push.
  const setAt = (props: Partial<ObjectState>, position: number) =>
    timeline.call(
      () => {
        Object.assign(proxy, props);
        push(Object.keys(props) as (keyof ObjectState)[]);
      },
      undefined,
      position,
    );

  const tweenTo = (vars: gsap.TweenVars, position = at, dur = duration) => {
    const keys = STATE_KEYS.filter((key) => key in vars);
    return timeline.to(
      proxy,
      { duration: dur, ease: anim.easing, ...vars, onUpdate: () => push(keys) },
      position,
    );
  };

  switch (anim.effect) {
    case "appear":
      setAt({ visible: true, opacity: state.opacity }, at);
      return;

    case "disappear":
      setAt({ visible: false, opacity: 0 }, at);
      return;

    case "fade":
      // The entrance's opacity-0 start is already in `initial`.
      tweenTo({
        opacity:
          anim.kind === "exit" ? 0 : (anim.params?.toOpacity ?? state.opacity),
      });
      return;

    case "fly":
      // Flies *in* to where the slide puts it, from the origin `entranceOffset`
      // parked it at. Entrance-only, so there is no "flies away" reading.
      tweenTo({ x: state.x, y: state.y, opacity: state.opacity });
      return;

    case "move": {
      // The journey is the animation's own: it starts where the object stands on
      // this slide and ends where the author drew it. A move with no destination
      // has not been drawn yet and goes nowhere, rather than quietly borrowing
      // some other slide's idea of where the object belongs.
      const destination = {
        x: anim.params?.toX ?? initial.x,
        y: anim.params?.toY ?? initial.y,
      };
      const waypoints = anim.params?.path ?? [];
      // No waypoints is the overwhelmingly common case and stays a plain
      // two-property tween — GSAP interpolates `x` and `y` directly, exactly as
      // it did before routes existed.
      if (waypoints.length === 0) {
        tweenTo(destination);
        return;
      }

      // A route's waypoints are *centres* (see `AnimParams.path`) and only the
      // interior ones are stored, so the ends come from the states the slides
      // already agree on. Half-size is taken once, from where the move starts:
      // an object that is also being scaled has no single centre offset, and
      // recomputing it per tick would make the drawn route and the travelled
      // one disagree.
      const half = { x: initial.w / 2, y: initial.h / 2 };
      const path = buildMotionPath(
        [
          { x: initial.x + half.x, y: initial.y + half.y },
          ...waypoints,
          { x: destination.x + half.x, y: destination.y + half.y },
        ],
        anim.params?.curve ?? 0,
      );

      // GSAP tweens *progress along the route*, not x and y, so the easing
      // applies to distance covered and the object holds the line between
      // waypoints instead of cutting corners. `walker` is per-tween rather than
      // the shared proxy: it is this animation's own clock.
      const walker = { t: 0 };
      timeline.to(
        walker,
        {
          t: 1,
          duration,
          ease: anim.easing,
          onUpdate: () => {
            const point = samplePath(path, walker.t);
            proxy.x = point.x - half.x;
            proxy.y = point.y - half.y;
            push(["x", "y"]);
          },
        },
        at,
      );
      return;
    }

    case "scale": {
      // A multiple of the object's own size, about its centre — so "grow to
      // 150%" is one number the animation carries, not a size difference
      // between two slides that only exists if there is a slide after this one.
      const factor = anim.params?.scale ?? 1;
      const w = initial.w * factor;
      const h = initial.h * factor;
      tweenTo({
        w,
        h,
        x: initial.x - (w - initial.w) / 2,
        y: initial.y - (h - initial.h) / 2,
      });
      return;
    }

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
