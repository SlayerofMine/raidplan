import type { Stage } from "konva/lib/Stage";
import {
  resolveObjectState,
  type Background,
  type PlanObject,
  type ResolvedStates,
  type Step,
} from "@raidplan/shared";
import { applyObjectState } from "../anim/applyToStage";
import { compileStep, type CompiledStep } from "../anim/compileStep";
import type { View } from "./canvas/coords";
import { evenSize, type Frame } from "./videoExport";

/**
 * Renders individual frames of a plan off the *live* editor stage, for
 * {@link ./videoExport.ts}.
 *
 * Each frame seeks a step's compiled GSAP timeline to an exact time and pushes
 * the result onto the Konva nodes — the same `compileStep` the viewer plays, so
 * an exported clip and playback can't diverge. Capture reuses the trick from
 * `pngExport.ts`: ask Konva for the plan's own rectangle and cancel the on-screen
 * zoom with `pixelRatio`, so frames are the map's native pixels whatever the
 * camera is doing.
 *
 * Konva can't render under jsdom, so this layer is verified by running the app;
 * the maths it stands on (`planFrames`, `evenSize`, `compileStep`) is unit-tested.
 */
export interface FrameRenderer {
  /** The clip's pixel size — the plan's native size, rounded even for VP9. */
  size: { width: number; height: number };
  renderFrame: (frame: Frame) => HTMLCanvasElement | null;
  /** Put the board back the way we found it, and drop the timelines. */
  restore: (stepIndex: number) => void;
}

export function createFrameRenderer(params: {
  stage: Stage;
  steps: readonly Step[];
  objects: Record<string, PlanObject>;
  objectIds: readonly string[];
  background: Background;
  view: View;
}): FrameRenderer {
  const { stage, steps, objects, objectIds, background, view } = params;
  const size = evenSize(background.width, background.height);

  const resolveAll = (index: number): ResolvedStates => {
    const states: ResolvedStates = {};
    for (const id of objectIds) {
      const object = objects[id];
      if (object) states[id] = resolveObjectState(object, steps, index);
    }
    return states;
  };

  const applyStates = (states: ResolvedStates) => {
    for (const [id, state] of Object.entries(states)) {
      applyObjectState(stage, id, state);
    }
  };

  const compiled = new Map<number, CompiledStep>();
  const timelineFor = (stepIndex: number): CompiledStep | null => {
    const cached = compiled.get(stepIndex);
    if (cached) return cached;
    const step = steps[stepIndex];
    if (!step) return null;
    const built = compileStep({
      step,
      start: resolveAll(stepIndex - 1),
      end: resolveAll(stepIndex),
      apply: (objectId, props) => applyObjectState(stage, objectId, props),
    });
    compiled.set(stepIndex, built);
    return built;
  };

  // Entering a step snaps to its start state, exactly as playback does — so a
  // frame never inherits stale attributes from the previous step.
  let currentStep: number | null = null;

  return {
    size,
    renderFrame: ({ stepIndex, timeMs }) => {
      const built = timelineFor(stepIndex);
      if (!built) return null;

      if (currentStep !== stepIndex) {
        currentStep = stepIndex;
        applyStates(built.initial);
      }
      built.timeline.seek(timeMs / 1000, false);
      stage.batchDraw();

      return stage.toCanvas({
        x: view.x,
        y: view.y,
        width: size.width * view.scale,
        height: size.height * view.scale,
        pixelRatio: 1 / view.scale,
      });
    },
    restore: (stepIndex) => {
      for (const built of compiled.values()) built.timeline.kill();
      compiled.clear();
      currentStep = null;
      applyStates(resolveAll(stepIndex));
      stage.batchDraw();
    },
  };
}
