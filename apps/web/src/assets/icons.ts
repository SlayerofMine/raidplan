import { svgToDataUri } from "./svg";

/**
 * A palette icon: a `data:` URI plus metadata. Phase 1 ships a small, hardcoded
 * set of **original** raid-marker tokens (numbered coloured discs) — deliberately
 * NOT Blizzard's raid-marker art, to stay clear of the IP concerns in plan §11.
 * Phase 2 replaces this with the manifest-driven, virtualized palette.
 */
export interface IconDef {
  id: string;
  name: string;
  category: "marker";
  /** Data URI, ready for an `<img>` src or a Konva image. */
  src: string;
}

/** A filled disc with a centred glyph — the shared shape of every marker. */
function markerSvg(fill: string, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<circle cx="32" cy="32" r="28" fill="${fill}" stroke="#0b0d12" stroke-width="3"/>` +
    `<text x="32" y="42" font-family="system-ui, sans-serif" font-size="30" font-weight="700" ` +
    `text-anchor="middle" fill="#0b0d12">${label}</text>` +
    `</svg>`
  );
}

const MARKERS: ReadonlyArray<{ id: string; label: string; fill: string }> = [
  { id: "marker-1", label: "1", fill: "#e6394a" },
  { id: "marker-2", label: "2", fill: "#f08a24" },
  { id: "marker-3", label: "3", fill: "#f2c744" },
  { id: "marker-4", label: "4", fill: "#46c66d" },
  { id: "marker-5", label: "5", fill: "#35c4d6" },
  { id: "marker-6", label: "6", fill: "#4f9dff" },
  { id: "marker-7", label: "7", fill: "#a06cf0" },
  { id: "marker-8", label: "8", fill: "#ef73c0" },
];

/** The ordered palette. */
export const ICONS: readonly IconDef[] = MARKERS.map((m) => ({
  id: m.id,
  name: `Marker ${m.label}`,
  category: "marker",
  src: svgToDataUri(markerSvg(m.fill, m.label)),
}));

const ICON_BY_ID: ReadonlyMap<string, IconDef> = new Map(
  ICONS.map((icon) => [icon.id, icon]),
);

/** Look up an icon by id, or `undefined` if it is not in the manifest. */
export function getIconById(id: string): IconDef | undefined {
  return ICON_BY_ID.get(id);
}
