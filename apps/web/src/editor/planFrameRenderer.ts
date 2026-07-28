import type { Stage } from "konva/lib/Stage";
import type { Background, PlanObject, Slide } from "@raidplan/shared";
import { createSlideScrubber } from "../anim/slideScrubber";
import type { View } from "./canvas/coords";
import { evenSize, type Frame } from "./videoExport";

/**
 * Renders individual frames of a plan off the *live* editor stage, for
 * {@link ./videoExport.ts}.
 *
 * The frame itself — seeking a slide's compiled timeline to an exact time,
 * simulating collisions, pushing the result onto the Konva nodes — is
 * {@link createSlideScrubber}, shared with the editor's playhead so a scrubbed
 * frame and an exported one are the same frame. What's left here is capture:
 * the trick from `pngExport.ts` of asking Konva for the plan's own rectangle and
 * cancelling the on-screen zoom with `pixelRatio`, so frames are the map's
 * native pixels whatever the camera is doing.
 */
export interface FrameRenderer {
  /** The clip's pixel size — the plan's native size, rounded even for VP9. */
  size: { width: number; height: number };
  renderFrame: (frame: Frame) => HTMLCanvasElement | null;
  /** Put the board back the way we found it, and drop the timelines. */
  restore: (slideIndex: number) => void;
}

export function createFrameRenderer(params: {
  stage: Stage;
  slides: readonly Slide[];
  objects: Record<string, PlanObject>;
  objectIds: readonly string[];
  background: Background;
  view: View;
}): FrameRenderer {
  const { stage, slides, objects, objectIds, background, view } = params;
  const size = evenSize(background.width, background.height);
  const scrubber = createSlideScrubber({ stage, slides, objects, objectIds });

  return {
    size,
    renderFrame: ({ slideIndex, timeMs }) => {
      if (!scrubber.seek(slideIndex, timeMs)) return null;
      return stage.toCanvas({
        x: view.x,
        y: view.y,
        width: size.width * view.scale,
        height: size.height * view.scale,
        pixelRatio: 1 / view.scale,
      });
    },
    restore: scrubber.restore,
  };
}
