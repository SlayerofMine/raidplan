import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IconStore } from "./types.js";

/**
 * Local-disk icon storage (plan §11.1 "Upload to … content-hashed URL").
 *
 * Files are named `<hash>_<size>.webp` — content-addressed, so the URL is
 * immutable and both the browser and Caddy/CDN can cache it forever. In
 * production this directory can be served straight by Caddy or swapped for an
 * OCI Object Storage {@link IconStore} without touching the pipeline; the store
 * is the seam.
 */
export interface LocalIconStoreOptions {
  dir: string;
  /** Public URL prefix these files are served under (default `/icons`). */
  publicPath?: string;
  writeFileImpl?: (path: string, bytes: Uint8Array) => Promise<void>;
  mkdirImpl?: (path: string) => Promise<void>;
}

/** Filename for a stored variant. Exported so the serving route agrees on it. */
export function iconFilename(hash: string, size: number): string {
  return `${hash}_${size}.webp`;
}

export function localIconStore({
  dir,
  publicPath = "/icons",
  writeFileImpl = (p, b) => writeFile(p, b),
  mkdirImpl = async (p) => {
    await mkdir(p, { recursive: true });
  },
}: LocalIconStoreOptions): IconStore {
  let ensured = false;
  return {
    async put(hash: string, size: number, bytes: Uint8Array) {
      if (!ensured) {
        await mkdirImpl(dir);
        ensured = true;
      }
      const filename = iconFilename(hash, size);
      await writeFileImpl(join(dir, filename), bytes);
      return `${publicPath}/${filename}`;
    },
  };
}
