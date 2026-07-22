import type { Stage } from "konva/lib/Stage";
import {
  resolveObjectState,
  type Background,
  type ObjectState,
  type PlanObject,
  type ResolvedStates,
  type Step,
} from "@raidplan/shared";
import {
  applyObjectState,
  objectRect,
  readObjectState,
} from "../anim/applyToStage";
import {
  collisionRules,
  isColliding,
  type CollisionRule,
  type RectLookup,
} from "../anim/collision";
import { compileStep, type CompiledStep } from "../anim/compileStep";
import { compileOneShot } from "../anim/oneShot";
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
 * **Collisions are simulated too.** `onCollision` animations sit outside the
 * step timeline, so each frame re-tests the armed rules against the boxes the
 * frame just produced and starts a one-shot the first time one connects — the
 * same detection and the same `compileOneShot` playback uses. Without this a
 * picked-up orb would never disappear in the exported video.
 *
 * Konva can't render under jsdom, so this layer is verified by running the app;
 * the maths it stands on (`planFrames`, `collisionRules`, `compileStep`) is
 * unit-tested.
 */
export interface FrameRenderer {
  /** The clip's pixel size — the plan's native size, rounded even for VP9. */
  size: { width: number; height: number };
  renderFrame: (frame: Frame) => HTMLCanvasElement | null;
  /** Put the board back the way we found it, and drop the timelines. */
  restore: (stepIndex: number) => void;
}

/** A collision animation that has fired, and when, so it can be seeked. */
interface FiredShot {
  timeline: gsap.core.Timeline;
  startedMs: number;
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

  const apply = (objectId: string, props: Partial<ObjectState>) =>
    applyObjectState(stage, objectId, props);
  const rectOf: RectLookup = (objectId) => objectRect(stage, objectId);

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
      apply,
    });
    compiled.set(stepIndex, built);
    return built;
  };

  // Entering a step snaps to its start state, exactly as playback does — so a
  // frame never inherits stale attributes from the previous step.
  let currentStep: number | null = null;
  let rules: CollisionRule[] = [];
  let fired = new Set<string>();
  let shots: FiredShot[] = [];

  /** Start any collision that has just connected, once each (a pickup is consumed). */
  const fireNewCollisions = (step: Step, stepIndex: number, timeMs: number) => {
    for (const rule of rules) {
      if (fired.has(rule.animId)) continue;
      if (!isColliding(rule, rectOf)) continue;

      const anim = step.animations.find((a) => a.id === rule.animId);
      const end = resolveAll(stepIndex);
      const target = anim && end[anim.objectId];
      if (!anim || !target) continue;

      fired.add(rule.animId);
      const built = compileOneShot({
        anim,
        step,
        start: {
          [anim.objectId]: readObjectState(stage, anim.objectId, target),
        },
        end,
        apply,
      });
      applyStates(built.initial);
      shots.push({ timeline: built.timeline, startedMs: timeMs });
    }
  };

  const killShots = () => {
    for (const shot of shots) shot.timeline.kill();
    shots = [];
  };

  return {
    size,
    renderFrame: ({ stepIndex, timeMs }) => {
      const built = timelineFor(stepIndex);
      const step = steps[stepIndex];
      if (!built || !step) return null;

      if (currentStep !== stepIndex) {
        currentStep = stepIndex;
        killShots();
        fired = new Set();
        rules = collisionRules(step.animations);
        applyStates(built.initial);
      }

      // `false` = don't suppress events, so `disappear`'s callback actually runs.
      built.timeline.seek(timeMs / 1000, false);

      // Test collisions against the positions this frame just produced...
      fireNewCollisions(step, stepIndex, timeMs);
      // ...then let anything already firing advance. Applied after the step
      // timeline so a triggered effect wins over the motion underneath it.
      for (const shot of shots) {
        shot.timeline.seek(
          Math.max(0, (timeMs - shot.startedMs) / 1000),
          false,
        );
      }

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
      killShots();
      for (const built of compiled.values()) built.timeline.kill();
      compiled.clear();
      currentStep = null;
      fired = new Set();
      rules = [];
      applyStates(resolveAll(stepIndex));
      stage.batchDraw();
    },
  };
}
