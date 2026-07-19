import type { Background } from "@raidplan/shared";
import type { View } from "./canvas/coords";
import { slugify } from "./planFile";

/**
 * PNG export of a plan step (plan §5.1).
 *
 * The board is drawn with a live zoom/pan transform, but an exported file should
 * be the map's own native pixels regardless of how the editor is framed. We ask
 * Konva for exactly the plan's rectangle and cancel the on-screen scale with the
 * pixel ratio, so the output is deterministic: `background.width × height`,
 * whatever the current zoom.
 *
 * For motion rather than a still, `videoExport.ts` exports the whole plan as a
 * WebM using this same native-rect trick, one frame at a time.
 */

/** The slice of Konva's `Stage` we use — narrowed so tests can pass a fake. */
export interface CapturableStage {
  toDataURL(config: {
    x: number;
    y: number;
    width: number;
    height: number;
    pixelRatio: number;
    mimeType: string;
  }): string;
}

/** File name for a step's export: `raid-night-step-2.png`, `…-base.png`. */
export function exportStepFileName(title: string, stepIndex: number): string {
  const step = stepIndex < 0 ? "base" : `step-${stepIndex + 1}`;
  return `${slugify(title)}-${step}.png`;
}

/**
 * Capture the whole plan at native resolution as a PNG data URL. `view` is the
 * current camera; the plan's native rect maps to the on-screen rect
 * `(view.x, view.y)` sized `native × view.scale`, and `pixelRatio = 1/scale`
 * undoes the zoom so the file is native-sized.
 */
export function capturePlanPng(
  stage: CapturableStage,
  background: Pick<Background, "width" | "height">,
  view: View,
): string {
  return stage.toDataURL({
    x: view.x,
    y: view.y,
    width: background.width * view.scale,
    height: background.height * view.scale,
    pixelRatio: 1 / view.scale,
    mimeType: "image/png",
  });
}

/** Trigger a browser download of a data URL. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
