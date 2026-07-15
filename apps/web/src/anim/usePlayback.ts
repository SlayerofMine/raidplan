import { useCallback, useEffect, useRef, useState } from "react";
import type { Stage } from "konva/lib/Stage";
import {
  resolveObjectState,
  type ObjectState,
  type ResolvedStates,
} from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { compileStep } from "./compileStep";

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
}

export function usePlayback(stageRef: { current: Stage | null }): PlaybackApi {
  const steps = useEditorStore((s) => s.steps);
  const objects = useEditorStore((s) => s.objects);
  const objectIds = useEditorStore((s) => s.objectIds);

  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const timeline = useRef<gsap.core.Timeline | null>(null);

  /** Write a resolved state straight onto its Konva node. */
  const applyToNode = useCallback(
    (objectId: string, props: ObjectState) => {
      const node = stageRef.current?.findOne(`#${objectId}`);
      if (!node) return;
      node.setAttrs({
        x: props.x,
        y: props.y,
        rotation: props.rotation,
        opacity: props.opacity,
        visible: props.visible,
      });
    },
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

  /**
   * Build the timeline for a step. Entering a step always snaps to its start
   * state first, so jumping in from anywhere lands in the same place (plan §7).
   */
  const buildStep = useCallback(
    (index: number) => {
      timeline.current?.kill();
      timeline.current = null;

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

  const play = useCallback(() => {
    const tl = timeline.current;
    if (!tl) return;
    // Replay from the top once it has run to the end.
    if (tl.progress() >= 1) tl.progress(0);
    tl.play();
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    timeline.current?.pause();
    setIsPlaying(false);
  }, []);

  const restart = useCallback(() => {
    const tl = buildStep(stepIndex);
    tl?.play();
    setIsPlaying(Boolean(tl));
  }, [buildStep, stepIndex]);

  const seek = useCallback((next: number) => {
    const tl = timeline.current;
    if (!tl) return;
    tl.pause();
    tl.progress(Math.max(0, Math.min(1, next)));
    setIsPlaying(false);
    setProgress(tl.progress());
  }, []);

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
  };
}
