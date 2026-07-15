import { Resvg } from "@resvg/resvg-js";
import type { Plan } from "@raidplan/shared";
import { renderPlanSvg, type RenderOptions } from "./renderPlanSvg.js";

/**
 * Rasterise a plan step to a PNG for Discord's link preview (plan §4.7).
 *
 * resvg (+ its prebuilt aarch64 binary) rather than node-canvas: it needs no
 * system libraries, which matters on the Ampere box (plan §3).
 */

/** Discord renders large previews at 2:1; 1200×630 is the conventional size. */
export const OG_WIDTH = 1200;

export function renderOgImage(
  plan: Plan,
  stepIndex = 0,
  options: RenderOptions = {},
): Buffer {
  const svg = renderPlanSvg(plan, stepIndex, options);
  const resvg = new Resvg(svg, {
    // Scale to a fixed width; the height follows the map's aspect ratio.
    fitTo: { mode: "width", value: OG_WIDTH },
    // Our SVGs embed no external references, but be explicit: an OG renderer
    // that fetched arbitrary URLs would be a server-side request forgery hole.
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}
