import type { FetchFn, IconIndexEntry, IconIndexSource } from "./types.js";

/**
 * The icon **index**: which icons exist in the game (plan §11.1 source "A").
 *
 * We use the community listfile (wowdev's `community-listfile.csv`), a plain
 * `FileDataID;path` text file updated every patch. It's the authoritative map
 * of name ↔ FileDataID and needs no game client to read.
 */
export const DEFAULT_LISTFILE_URL =
  "https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv";

/** Only interface icon textures — the listfile covers every file in the game. */
const ICON_PREFIX = "interface/icons/";
const ICON_SUFFIX = ".blp";

/**
 * Parse a listfile into the icon index, filtered to interface icons.
 *
 * Pure and defensive: rows are `id;path` (semicolon) but a comma variant is
 * tolerated; blank and malformed rows are skipped; names are deduped keeping
 * the first FileDataID seen. Kept separate from the fetch so it can be tested
 * on a handful of representative lines rather than a 40 MB download.
 */
export function parseListfile(text: string): IconIndexEntry[] {
  const seen = new Set<string>();
  const entries: IconIndexEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const sep = line.includes(";") ? ";" : ",";
    const idx = line.indexOf(sep);
    if (idx < 0) continue;

    const idText = line.slice(0, idx).trim();
    const path = line
      .slice(idx + 1)
      .trim()
      .toLowerCase();
    if (!path.startsWith(ICON_PREFIX) || !path.endsWith(ICON_SUFFIX)) continue;

    const name = path.slice(ICON_PREFIX.length, -ICON_SUFFIX.length);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const fileDataId = Number.parseInt(idText, 10);
    entries.push({
      name,
      fileDataId: Number.isFinite(fileDataId) ? fileDataId : null,
    });
  }

  return entries;
}

export interface ListfileIndexOptions {
  fetchImpl?: FetchFn;
  url?: string;
}

/** An {@link IconIndexSource} backed by the community listfile over HTTP. */
export function listfileIndexSource({
  fetchImpl = fetch,
  url = DEFAULT_LISTFILE_URL,
}: ListfileIndexOptions = {}): IconIndexSource {
  return {
    async listIcons() {
      const res = await fetchImpl(url);
      if (!res.ok) {
        throw new Error(`Listfile fetch failed: ${res.status} ${url}`);
      }
      return parseListfile(await res.text());
    },
  };
}
