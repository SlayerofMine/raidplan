import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { Stage } from "konva/lib/Stage";
import {
  resolveObjectState,
  type Anim,
  type ObjectState,
  type ResolvedStates,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { applyObjectState, objectRect, readObjectState } from "./applyToStage";
import { collidingAnimIds, collisionRules, type RectLookup } from "./collision";
import { compileStep } from "./compileStep";
import { compileOneShot, deferredAnimsFor } from "./oneShot";

/**
 * The playback engine (plan §3.5 / §8.1).
 *
 * The golden rule: **React owns the document while editing; GSAP owns the
 * pixels while playing.** During playback this never calls `setState` per
 * frame — it writes straight to Konva nodes and calls `batchDraw()`. The only
 * React state here is coarse transport status (playing/paused, which step),
 * which changes a handful of times per plan, not 60 times a second.
 */
export interface PlaybackApi {
  stepIndex: number;
  isPlaying: boolean;
  /** 0..1 within the current step. */
  progress: number;
  stepCount: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  next: () => void;
  previous: () => void;
  goTo: (stepIndex: number) => void;
  seek: (progress: number) => void;
  /**
   * Fire this object's `onClick` animations, if it has any. The viewer calls it
   * when the object is clicked (plan §7).
   */
  triggerClick: (objectId: string) => void;
  /**
   * Objects on the current step with an `onClick` animation. The viewer only
   * turns on hit-testing when this is non-empty, so the usual case keeps the
   * `listening={false}` fast path (plan §8.4).
   */
  clickableObjectIds: string[];
}

export function usePlayback(stageRef: { current: Stage | null }): PlaybackApi {
  const steps = useEditorStore((s) => s.steps);
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  /**
   * The step is *in play*: the transport was started and hasn't been stopped or
   * moved. Distinct from `isPlaying`, which the step's own timeline clears when
   * it completes — a triggered animation can still be running (or about to be
   * triggered) long after that, so the collision watch keys off this instead.
   */
  const [armed, setArmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  /**
   * Deferred animations already fired this playthrough. A pickup is *consumed*:
   * it fires on first contact and stays spent until the step is rebuilt
   * (restart or a step change), which is where this is cleared.
   */
  const fired = useRef<Set<string>>(new Set());
  /** Timelines started by a trigger, so transport controls can govern them too. */
  const oneShots = useRef<gsap.core.Timeline[]>([]);

  /** Write state — whole or partial — straight onto its Konva node. */
  const applyToNode = useCallback(
    (objectId: string, props: Partial<ObjectState>) =>
      applyObjectState(stageRef.current, objectId, props),
    [stageRef],
  );

  const redraw = useCallback(() => {
    stageRef.current?.batchDraw();
  }, [stageRef]);

  /** Snap every object to a fully-resolved set of states. */
  const applyStates = useCallback(
    (states: ResolvedStates) => {
      for (const [objectId, state] of Object.entries(states)) {
        applyToNode(objectId, state);
      }
      redraw();
    },
    [applyToNode, redraw],
  );

  const resolveAll = useCallback(
    (index: number): ResolvedStates => {
      const states: ResolvedStates = {};
      for (const id of objectIds) {
        const object = objects[id];
        if (object) states[id] = resolveObjectState(object, steps, index);
      }
      return states;
    },
    [objects, objectIds, steps],
  );

  const liveStateOf = useCallback(
    (objectId: string, fallback: ObjectState): ObjectState =>
      readObjectState(stageRef.current, objectId, fallback),
    [stageRef],
  );

  /** Run a single deferred animation now (see `oneShot.ts`). */
  const fireAnim = useCallback(
    (anim: Anim) => {
      const step = steps[stepIndex];
      if (!step) return;
      const end = resolveAll(stepIndex);
      const target = end[anim.objectId];
      if (!target) return;

      const { timeline: tl, initial } = compileOneShot({
        anim,
        step,
        start: { [anim.objectId]: liveStateOf(anim.objectId, target) },
        end,
        apply: applyToNode,
        onUpdate: redraw,
      });
      // Entrance effects need their offset applied before the first tick.
      applyStates(initial);
      oneShots.current.push(tl);
      tl.play();
    },
    [
      steps,
      stepIndex,
      resolveAll,
      liveStateOf,
      applyToNode,
      applyStates,
      redraw,
    ],
  );

  /**
   * Build the timeline for a step. Entering a step always snaps to its start
   * state first, so jumping in from anywhere lands in the same place (plan §7).
   */
  const buildStep = useCallback(
    (index: number) => {
      timeline.current?.kill();
      timeline.current = null;
      // Rebuilding a step re-arms every pickup and drops anything a trigger
      // started, so a replay is identical to the first run.
      for (const shot of oneShots.current) shot.kill();
      oneShots.current = [];
      fired.current.clear();

      const step = steps[index];
      if (!step) return null;

      const { timeline: tl, initial } = compileStep({
        step,
        start: resolveAll(index - 1),
        end: resolveAll(index),
        apply: applyToNode,
        onUpdate: redraw,
      });

      applyStates(initial);
      tl.eventCallback("onUpdate", () => {
        redraw();
        setProgress(tl.progress());
      });
      tl.eventCallback("onComplete", () => {
        setIsPlaying(false);
        setProgress(1);
      });

      timeline.current = tl;
      return tl;
    },
    [steps, resolveAll, applyToNode, redraw, applyStates],
  );

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(index, steps.length - 1));
      setStepIndex(clamped);
      setIsPlaying(false);
      setArmed(false);
      setProgress(0);
      buildStep(clamped);
    },
    [steps.length, buildStep],
  );

  // Rebuild whenever the step or the document changes underneath us.
  useEffect(() => {
    buildStep(stepIndex);
    return () => {
      timeline.current?.kill();
      timeline.current = null;
    };
  }, [buildStep, stepIndex]);

  /**
   * Collision watch — while the step is **in play** (plan §7).
   *
   * Rides GSAP's global ticker rather than the step timeline's `onUpdate`, and
   * keys off `armed` rather than `isPlaying`, so a collision caused *by* a
   * triggered animation is still caught after the step's own timeline has
   * finished. Keying off `isPlaying` quietly broke that: the timeline clears it
   * on completion, so contact was only ever possible during the step's own
   * animations. Boxes are read from the live Konva nodes, which is what makes
   * this work mid-tween. No React state is touched per frame, and a step with
   * no armed rules — nearly all of them — adds no ticker at all.
   */
  useEffect(() => {
    if (!armed) return;
    const animations = steps[stepIndex]?.animations ?? [];
    const rules = collisionRules(animations);
    if (rules.length === 0) return;

    const rectOf: RectLookup = (objectId) =>
      objectRect(stageRef.current, objectId);

    const tick = () => {
      for (const animId of collidingAnimIds(rules, rectOf)) {
        if (fired.current.has(animId)) continue;
        const anim = animations.find((a) => a.id === animId);
        if (!anim) continue;
        fired.current.add(animId); // consumed: never fires twice per playthrough
        fireAnim(anim);
      }
    };

    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [armed, steps, stepIndex, stageRef, fireAnim]);

  const play = useCallback(() => {
    const tl = timeline.current;
    if (!tl) return;
    // Replay from the top once it has run to the end.
    if (tl.progress() >= 1) tl.progress(0);
    tl.play();
    // Anything a trigger started resumes with the transport.
    for (const shot of oneShots.current) shot.play();
    setIsPlaying(true);
    setArmed(true);
  }, []);

  const pause = useCallback(() => {
    timeline.current?.pause();
    for (const shot of oneShots.current) shot.pause();
    setIsPlaying(false);
    setArmed(false);
  }, []);

  const restart = useCallback(() => {
    const tl = buildStep(stepIndex);
    tl?.play();
    setIsPlaying(Boolean(tl));
    setArmed(Boolean(tl));
  }, [buildStep, stepIndex]);

  const seek = useCallback((next: number) => {
    const tl = timeline.current;
    if (!tl) return;
    tl.pause();
    tl.progress(Math.max(0, Math.min(1, next)));
    setIsPlaying(false);
    setArmed(false);
    setProgress(tl.progress());
  }, []);

  /**
   * Fire an object's `onClick` animations. Unlike collisions this doesn't
   * require the transport to be running — the viewer *is* play mode, and
   * click-to-advance is the whole point of the trigger (plan §7). Each fires at
   * most once per playthrough, like a pickup.
   */
  const triggerClick = useCallback(
    (objectId: string) => {
      for (const anim of deferredAnimsFor(
        steps[stepIndex],
        objectId,
        "onClick",
      )) {
        if (fired.current.has(anim.id)) continue;
        fired.current.add(anim.id);
        fireAnim(anim);
      }
    },
    [steps, stepIndex, fireAnim],
  );

  const clickableObjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const anim of steps[stepIndex]?.animations ?? []) {
      if (anim.trigger === "onClick") ids.add(anim.objectId);
    }
    return [...ids];
  }, [steps, stepIndex]);

  return {
    stepIndex,
    isPlaying,
    progress,
    stepCount: steps.length,
    play,
    pause,
    toggle: () => (isPlaying ? pause() : play()),
    restart,
    next: () => goTo(stepIndex + 1),
    previous: () => goTo(stepIndex - 1),
    goTo,
    seek,
    triggerClick,
    clickableObjectIds,
  };
}
