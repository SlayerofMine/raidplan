import type { Background } from "@raidplan/shared";
import { svgToDataUri } from "./svg";

/**
 * The bundled map set (plan §2.9 map/raid selector). All original artwork —
 * stylised, generic encounter floors rather than Blizzard maps (§11). User
 * uploads extend this registry in Phase 4.8.
 *
 * Every plan stores coordinates in its background's **native pixel space**, so
 * each map declares its own intrinsic size.
 */
export interface BackgroundDef {
  assetId: string;
  name: string;
  width: number;
  height: number;
  src: string;
}

const GRID =
  `<defs><pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">` +
  `<path d="M80 0H0V80" fill="none" stroke="#1c2432" stroke-width="1.5"/></pattern></defs>`;

function frame(w: number, h: number, inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    GRID +
    `<rect width="${w}" height="${h}" fill="#0f141c"/>` +
    `<rect width="${w}" height="${h}" fill="url(#grid)"/>` +
    inner +
    `</svg>`
  );
}

const STROKE = `fill="none" stroke="#2b3a55" stroke-opacity="0.55" stroke-width="3"`;

/** Open arena: concentric rings around a centre point. */
function arenaSvg(w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2;
  return frame(
    w,
    h,
    `<circle cx="${cx}" cy="${cy}" r="220" ${STROKE}/>` +
      `<circle cx="${cx}" cy="${cy}" r="90" ${STROKE}/>`,
  );
}

/** Boss chamber: a bounded room with four pillars. */
function chamberSvg(w: number, h: number): string {
  const pillars = [
    [w * 0.28, h * 0.3],
    [w * 0.72, h * 0.3],
    [w * 0.28, h * 0.7],
    [w * 0.72, h * 0.7],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="55" ${STROKE}/>`)
    .join("");
  return frame(
    w,
    h,
    `<rect x="80" y="60" width="${w - 160}" height="${h - 120}" rx="40" ${STROKE}/>` +
      pillars,
  );
}

/** Corridor: a long approach split into three lanes. */
function corridorSvg(w: number, h: number): string {
  return frame(
    w,
    h,
    `<rect x="60" y="${h * 0.2}" width="${w - 120}" height="${h * 0.6}" rx="24" ${STROKE}/>` +
      `<line x1="60" y1="${h * 0.4}" x2="${w - 60}" y2="${h * 0.4}" ${STROKE}/>` +
      `<line x1="60" y1="${h * 0.6}" x2="${w - 60}" y2="${h * 0.6}" ${STROKE}/>`,
  );
}

export const BACKGROUNDS: readonly BackgroundDef[] = [
  {
    assetId: "arena",
    name: "Arena",
    width: 1600,
    height: 900,
    src: svgToDataUri(arenaSvg(1600, 900)),
  },
  {
    assetId: "chamber",
    name: "Boss chamber",
    width: 1600,
    height: 900,
    src: svgToDataUri(chamberSvg(1600, 900)),
  },
  {
    assetId: "corridor",
    name: "Corridor",
    width: 1920,
    height: 800,
    src: svgToDataUri(corridorSvg(1920, 800)),
  },
];

const BY_ID: ReadonlyMap<string, BackgroundDef> = new Map(
  BACKGROUNDS.map((b) => [b.assetId, b]),
);

export function getBackgroundDef(assetId: string): BackgroundDef | undefined {
  return BY_ID.get(assetId);
}

/** Resolve a background's image `data:` URI by asset id. */
export function getBackgroundSrc(assetId: string): string | undefined {
  return BY_ID.get(assetId)?.src;
}

/** The `Background` document value for a bundled map. */
export function toBackground(def: BackgroundDef): Background {
  return { assetId: def.assetId, width: def.width, height: def.height };
}

export const DEFAULT_BACKGROUND: Background = toBackground(BACKGROUNDS[0]!);
