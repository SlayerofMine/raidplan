import type { Background } from "@raidplan/shared";
import { svgToDataUri } from "./svg";

/**
 * Phase 1 ships one bundled, **original** background — a stylised arena floor
 * (grid + centre ring), not a Blizzard map (plan §11). Backgrounds are keyed by
 * `assetId`; the map/raid picker (Phase 2.9) and uploads (Phase 4) extend this
 * registry. Coordinates everywhere are in this native pixel space (plan §5).
 */
export const ARENA_BACKGROUND: Background = {
  assetId: "arena",
  width: 1600,
  height: 900,
};

function arenaSvg(w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs>` +
    `<pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">` +
    `<path d="M80 0H0V80" fill="none" stroke="#1c2432" stroke-width="1.5"/>` +
    `</pattern>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="#0f141c"/>` +
    `<rect width="${w}" height="${h}" fill="url(#grid)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="220" fill="none" stroke="#2b3a55" stroke-opacity="0.5" stroke-width="3"/>` +
    `<circle cx="${cx}" cy="${cy}" r="90" fill="none" stroke="#2b3a55" stroke-opacity="0.5" stroke-width="3"/>` +
    `</svg>`
  );
}

const BACKGROUND_SRC: Readonly<Record<string, string>> = {
  arena: svgToDataUri(
    arenaSvg(ARENA_BACKGROUND.width, ARENA_BACKGROUND.height),
  ),
};

/** Resolve a background's image `data:` URI by asset id. */
export function getBackgroundSrc(assetId: string): string | undefined {
  return BACKGROUND_SRC[assetId];
}
