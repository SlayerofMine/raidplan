import gsap from "gsap";
import {
  buildMotionPath,
  centrePoint,
  isDeferredTrigger,
  samplePath,
  topLeftForCentre,
  layoutStepTimeline,
  stateBeforeAnim,
  type Anim,
  type ObjectState,
  type Point,
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
      // Where this animation's object stands when it starts — the opening state
      // with everything before it folded in. A move begins *there*, so a slide
      // can chain "out, wait, back" as three moves without the second one
      // teleporting to where the slide opened. Computed from the slide's own
      // state rather than the entrance-adjusted `initial`, because that is what
      // `settledState` is defined over (a fade-in ends at the slide's opacity,
      // not at the 0 the entrance parked it on).
      origin: stateBeforeAnim(
        states[anim.objectId]!,
        animations,
        anim.objectId,
        anim.id,
      ),
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
  /**
   * Where the object stands by the time this animation runs — the slide's
   * layout with every earlier animation on it folded in. What a `move` starts
   * from, so consecutive moves chain end-to-end.
   */
  origin: ObjectState;
  /** The slide's own value for this object, before an entrance displaced it. */
  state: ObjectState;
  at: number;
  duration: number;
  apply: (objectId: string, props: Partial<ObjectState>) => void;
}

/**
 * The top-left a box of size `to` needs so that its centre lands where a box of
 * size `from`, standing at `at`, has its centre.
 *
 * The one statement of "grows about its own middle", used both to fold the size
 * channel into the position on the way out and to undo it on the way in. It
 * goes through `centrePoint` rather than a bare `w / 2` because a box turns
 * about its top-left: on a rotated object the growth runs along the turned axes,
 * so the shift that keeps it in place has to be turned with them.
 */
function recentre(
  at: Pick<ObjectState, "x" | "y" | "rotation">,
  from: Pick<ObjectState, "w" | "h">,
  to: Pick<ObjectState, "w" | "h">,
): Point {
  // `from`/`to` are read a field at a time rather than spread: the callers pass
  // whole states, and spreading one would carry its *own* `x`/`y` in and
  // silently move the box to wherever that state stood.
  const box = { x: at.x, y: at.y, rotation: at.rotation };
  return topLeftForCentre(
    { ...box, w: to.w, h: to.h },
    centrePoint({ ...box, w: from.w, h: from.h }),
  );
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
  origin,
  state,
  at,
  duration,
  apply,
}: TweenParams): void {
  /**
   * Push the proxy out, folding the size channel's centring into the position.
   *
   * `proxy.x`/`proxy.y` hold where the object would stand **at the size the
   * slide drew it**; the shift that keeps a growing object swelling about its
   * own centre is derived here from `w`/`h` instead of being written into
   * `x`/`y` by the size animation. That separation is what lets `scale` and
   * `move` run at the same time: they own different channels, so neither
   * overwrites the other's frame. Before, the scale re-asserted an absolute
   * `x`/`y` computed at compile time, and a travelling object was dragged back
   * to wherever the slide opened.
   *
   * A size push therefore carries `x`/`y` with it — the corner is a function of
   * the size, so the two can never be a frame apart.
   *
   * Stated as "hold the centre still" rather than as half the growth off the
   * corner, because a box turns about its **top-left**: on a rotated object the
   * growth runs along the turned axes, and taking it off `x`/`y` straight sent
   * the thing sliding away as it swelled.
   */
  const push = (keys: readonly (keyof ObjectState)[]) => {
    const patch: Partial<ObjectState> = {};
    for (const key of keys) patch[key] = proxy[key] as never;
    if (patch.w !== undefined || patch.h !== undefined) {
      patch.x = proxy.x;
      patch.y = proxy.y;
    }
    if (patch.x !== undefined && patch.y !== undefined) {
      Object.assign(patch, recentre(proxy, initial, proxy));
    }
    apply(anim.objectId, patch);
  };

  /**
   * A top-left as everything outside this function states it — slides, settled
   * states, drawn routes — moved into the position channel's frame.
   *
   * Those all speak the object's *displayed* corner, which an earlier scale has
   * already shifted; `push` re-applies that shift on the way out, so it has to
   * come off on the way in or it would count twice. `origin` supplies the size
   * in force when this animation starts, which is the size those coordinates
   * were stated against.
   */
  const anchorFor = (p: Point) =>
    recentre({ ...p, rotation: origin.rotation }, origin, initial);

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
      tweenTo({ ...anchorFor(state), opacity: state.opacity });
      return;

    case "move": {
      // The journey is the animation's own: it starts where the object stands
      // *by the time this move runs* (`origin` — the slide's layout with any
      // earlier move already folded in) and ends where the author drew it. A
      // move with no destination has not been drawn yet and goes nowhere,
      // rather than quietly borrowing some other slide's idea of where the
      // object belongs.
      const destination = {
        x: anim.params?.toX ?? origin.x,
        y: anim.params?.toY ?? origin.y,
      };
      const waypoints = anim.params?.path ?? [];
      // No waypoints is the overwhelmingly common case and stays a plain
      // two-property tween — GSAP interpolates `x` and `y` directly, exactly as
      // it did before routes existed.
      if (waypoints.length === 0) {
        tweenTo(anchorFor(destination));
        return;
      }

      // A route's waypoints are *centres* (see `AnimParams.path`) and only the
      // interior ones are stored, so the ends come from the states the slides
      // already agree on. `centrePoint` rather than a half-size offset: the box
      // turns about its top-left, so a rotated object's middle is not
      // `x + w/2` and a route built that way runs alongside the token instead
      // of under it. Measured once, from where the move starts: an object that
      // is also being scaled has no single centre offset, and recomputing it
      // per tick would make the drawn route and the travelled one disagree.
      const box = { ...origin };
      const path = buildMotionPath(
        [
          centrePoint(box),
          ...waypoints,
          centrePoint({ ...box, x: destination.x, y: destination.y }),
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
            const at = anchorFor(
              topLeftForCentre(box, samplePath(path, walker.t)),
            );
            proxy.x = at.x;
            proxy.y = at.y;
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
      // Only the size channel moves. Where the growth carries the top-left is
      // `push`'s business, derived from the size on the frame it is drawn — so
      // an object that is also being moved keeps travelling and simply swells
      // about wherever its centre has got to.
      const factor = anim.params?.scale ?? 1;
      tweenTo({ w: initial.w * factor, h: initial.h * factor });
      return;
    }

    case "pulse": {
      // Swell about the centre, then settle back to exactly the size it
      // started at — and, like `scale`, about whatever centre the object has by
      // then, so a pulse can play over a move.
      tweenTo(
        { w: initial.w * PULSE_SCALE, h: initial.h * PULSE_SCALE },
        at,
        duration / 2,
      );
      tweenTo({ w: initial.w, h: initial.h }, at + duration / 2, duration / 2);
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
