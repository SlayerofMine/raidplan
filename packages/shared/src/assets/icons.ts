import { svgToDataUri } from "./svg.js";

/**
 * The icon manifest (plan §11). Every icon here is **original** artwork — plain
 * coloured discs with a text glyph — deliberately not Blizzard's icon art. Class
 * *colours* are used (they're factual identifiers, not artwork) so tokens read
 * correctly to a raider. Keep this manifest source-attributed and swappable.
 */
export type IconCategory = "marker" | "role" | "class";

export interface IconDef {
  id: string;
  name: string;
  category: IconCategory;
  /** Free-text search terms for the palette filter (plan §2.1). */
  tags: string[];
  /** Data URI, ready for an `<img>` src or a Konva image. */
  src: string;
  /**
   * The same artwork as raw SVG markup **without** an `<svg>` wrapper, drawn in
   * a {@link ICON_VIEWBOX}-square coordinate space.
   *
   * The server-side preview renderer (plan §4.7) inlines this rather than
   * embedding `src`: resvg silently drops `<text>` inside an embedded SVG
   * `<image>`, which would render every raid marker as a blank coloured disc —
   * losing the number that *is* the marker. Inlined, the text renders.
   */
  body: string;
  /** Applied as the token's ring colour when added (plan §2.5). */
  tint?: string;
}

/** Icons are authored in a 64×64 space; callers scale from there. */
export const ICON_VIEWBOX = 64;

/** A filled disc with a centred glyph — the shared shape of every token. */
function discBody(fill: string, label: string, textColor = "#0b0d12"): string {
  const fontSize = label.length >= 3 ? 18 : label.length === 2 ? 24 : 30;
  return (
    `<circle cx="32" cy="32" r="28" fill="${fill}" stroke="#0b0d12" stroke-width="3"/>` +
    // `sans-serif` last: resvg resolves the generic family, and the browser
    // still prefers the nicer system font ahead of it.
    `<text x="32" y="${32 + fontSize * 0.36}" font-family="system-ui, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" text-anchor="middle" fill="${textColor}">${label}</text>`
  );
}

/** Wrap icon markup as a standalone SVG document. */
function iconDocument(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}" ` +
    `width="${ICON_VIEWBOX}" height="${ICON_VIEWBOX}">${body}</svg>`
  );
}

interface DiscSpec {
  id: string;
  name: string;
  label: string;
  fill: string;
  tags: string[];
  tint?: string;
}

const MARKERS: DiscSpec[] = [
  {
    id: "marker-1",
    name: "Marker 1",
    label: "1",
    fill: "#e6394a",
    tags: ["red"],
  },
  {
    id: "marker-2",
    name: "Marker 2",
    label: "2",
    fill: "#f08a24",
    tags: ["orange"],
  },
  {
    id: "marker-3",
    name: "Marker 3",
    label: "3",
    fill: "#f2c744",
    tags: ["yellow"],
  },
  {
    id: "marker-4",
    name: "Marker 4",
    label: "4",
    fill: "#46c66d",
    tags: ["green"],
  },
  {
    id: "marker-5",
    name: "Marker 5",
    label: "5",
    fill: "#35c4d6",
    tags: ["cyan"],
  },
  {
    id: "marker-6",
    name: "Marker 6",
    label: "6",
    fill: "#4f9dff",
    tags: ["blue"],
  },
  {
    id: "marker-7",
    name: "Marker 7",
    label: "7",
    fill: "#a06cf0",
    tags: ["purple"],
  },
  {
    id: "marker-8",
    name: "Marker 8",
    label: "8",
    fill: "#ef73c0",
    tags: ["pink"],
  },
];

const ROLES: DiscSpec[] = [
  {
    id: "role-tank",
    name: "Tank",
    label: "T",
    fill: "#4f9dff",
    tags: ["role"],
    tint: "#4f9dff",
  },
  {
    id: "role-healer",
    name: "Healer",
    label: "H",
    fill: "#46c66d",
    tags: ["role", "heal"],
    tint: "#46c66d",
  },
  {
    id: "role-dps",
    name: "DPS",
    label: "D",
    fill: "#e6394a",
    tags: ["role", "damage"],
    tint: "#e6394a",
  },
];

/** Canonical WoW class colours. */
const CLASSES: DiscSpec[] = [
  {
    id: "class-warrior",
    name: "Warrior",
    label: "WAR",
    fill: "#C79C6E",
    tags: ["class"],
    tint: "#C79C6E",
  },
  {
    id: "class-paladin",
    name: "Paladin",
    label: "PAL",
    fill: "#F58CBA",
    tags: ["class"],
    tint: "#F58CBA",
  },
  {
    id: "class-hunter",
    name: "Hunter",
    label: "HUN",
    fill: "#ABD473",
    tags: ["class"],
    tint: "#ABD473",
  },
  {
    id: "class-rogue",
    name: "Rogue",
    label: "ROG",
    fill: "#FFF569",
    tags: ["class"],
    tint: "#FFF569",
  },
  {
    id: "class-priest",
    name: "Priest",
    label: "PRI",
    fill: "#FFFFFF",
    tags: ["class"],
    tint: "#FFFFFF",
  },
  {
    id: "class-deathknight",
    name: "Death Knight",
    label: "DK",
    fill: "#C41F3B",
    tags: ["class", "dk"],
    tint: "#C41F3B",
  },
  {
    id: "class-shaman",
    name: "Shaman",
    label: "SHA",
    fill: "#0070DE",
    tags: ["class"],
    tint: "#0070DE",
  },
  {
    id: "class-mage",
    name: "Mage",
    label: "MAG",
    fill: "#69CCF0",
    tags: ["class"],
    tint: "#69CCF0",
  },
  {
    id: "class-warlock",
    name: "Warlock",
    label: "WLK",
    fill: "#9482C9",
    tags: ["class", "lock"],
    tint: "#9482C9",
  },
  {
    id: "class-monk",
    name: "Monk",
    label: "MNK",
    fill: "#00FF96",
    tags: ["class"],
    tint: "#00FF96",
  },
  {
    id: "class-druid",
    name: "Druid",
    label: "DRU",
    fill: "#FF7D0A",
    tags: ["class"],
    tint: "#FF7D0A",
  },
  {
    id: "class-demonhunter",
    name: "Demon Hunter",
    label: "DH",
    fill: "#A330C9",
    tags: ["class"],
    tint: "#A330C9",
  },
  {
    id: "class-evoker",
    name: "Evoker",
    label: "EVO",
    fill: "#33937F",
    tags: ["class"],
    tint: "#33937F",
  },
];

function build(specs: DiscSpec[], category: IconCategory): IconDef[] {
  return specs.map((s) => {
    const body = discBody(s.fill, s.label);
    return {
      id: s.id,
      name: s.name,
      category,
      tags: [...s.tags, s.name.toLowerCase(), category],
      body,
      src: svgToDataUri(iconDocument(body)),
      ...(s.tint ? { tint: s.tint } : {}),
    };
  });
}

/** The ordered palette manifest. */
export const ICONS: readonly IconDef[] = [
  ...build(MARKERS, "marker"),
  ...build(ROLES, "role"),
  ...build(CLASSES, "class"),
];

export const ICON_CATEGORIES: readonly IconCategory[] = [
  "marker",
  "role",
  "class",
];

const ICON_BY_ID: ReadonlyMap<string, IconDef> = new Map(
  ICONS.map((icon) => [icon.id, icon]),
);

/** Look up an icon by id, or `undefined` if it is not in the manifest. */
export function getIconById(id: string): IconDef | undefined {
  return ICON_BY_ID.get(id);
}

/**
 * Filter the manifest by category and a free-text query (matched against the
 * name and tags). An empty query matches everything in the category.
 */
export function searchIcons(
  query: string,
  category: IconCategory | "all" = "all",
): IconDef[] {
  const q = query.trim().toLowerCase();
  return ICONS.filter((icon) => {
    if (category !== "all" && icon.category !== category) return false;
    if (!q) return true;
    return (
      icon.name.toLowerCase().includes(q) ||
      icon.tags.some((tag) => tag.includes(q))
    );
  });
}
