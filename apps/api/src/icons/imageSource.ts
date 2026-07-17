import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchFn, IconImageSource, IconIndexEntry } from "./types.js";

/**
 * Image-byte adapters (plan §11.1 "Source adapter — pluggable").
 *
 * Each returns raw source bytes (JPG/PNG/BLP) for one icon, which the pipeline
 * then converts to WebP and stores. Plans never reference these bytes or URLs —
 * only the stable icon id — so the adapter is a pure implementation detail and
 * swapping it changes no plan data and no frontend code.
 */

// --- Wowhead-by-name -------------------------------------------------------

/**
 * Wowhead's icon CDN, addressed by icon name. `large` is 56px.
 *
 * ⚠️ Hotlinking Wowhead at *runtime* is against their wishes (§11.1): this
 * adapter is used only by the sync job to **cache into our own store**. The app
 * never points an `<img>` here — it points at our storage URLs.
 */
export const DEFAULT_WOWHEAD_ICON_BASE =
  "https://wow.zamimg.com/images/wow/icons/large";

export interface WowheadImageSourceOptions {
  fetchImpl?: FetchFn;
  base?: string;
}

export function wowheadImageSource({
  fetchImpl = fetch,
  base = DEFAULT_WOWHEAD_ICON_BASE,
}: WowheadImageSourceOptions = {}): IconImageSource {
  return {
    name: "wowhead",
    async fetchImage(entry: IconIndexEntry) {
      const res = await fetchImpl(`${base}/${entry.name}.jpg`);
      if (!res.ok) return null; // 404 = no such icon at this source; skip it.
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

// --- Local pack ------------------------------------------------------------

/** Extensions a pack file may use, in preference order. */
const PACK_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

export interface PackImageSourceOptions {
  /** Directory holding `<name>.<ext>` image files. */
  dir: string;
  readFileImpl?: (path: string) => Promise<Uint8Array>;
}

/**
 * Reads icon bytes from a local directory of `<name>.<ext>` files.
 *
 * The zero-network default (§11.1 "start with the simplest"): drop a curated
 * pack into `ICON_DIR/pack` and sync from it — no third party, no hotlinking,
 * fully reproducible in dev and tests. Missing file → `null` → skipped.
 */
export function packImageSource({
  dir,
  readFileImpl = (p) => readFile(p),
}: PackImageSourceOptions): IconImageSource {
  return {
    name: "pack",
    async fetchImage(entry: IconIndexEntry) {
      for (const ext of PACK_EXTENSIONS) {
        try {
          return await readFileImpl(join(dir, `${entry.name}.${ext}`));
        } catch {
          // Try the next extension; only "none found" yields null.
        }
      }
      return null;
    },
  };
}
