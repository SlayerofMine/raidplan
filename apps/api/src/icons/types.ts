import type { IconSourceName } from "../db/schema.js";

/**
 * The pluggable seams of the Icon Sync Service (plan §11.1).
 *
 * Everything the sync touches that reaches outside the process — the icon
 * index, the image bytes, image conversion, blob storage, build detection — is
 * an interface here. The orchestrator (`syncIcons`) depends only on these, so
 * it is pure control flow and fully unit-testable with in-memory fakes, and the
 * bulk image source can be swapped (pack → Wowhead → TACT/CASC) with **no**
 * change to plan data or the orchestrator (§11.1 "start with the simplest").
 */

/** A fetch implementation, injected so tests never touch the network. */
export type FetchFn = typeof fetch;

/** One icon as it appears in the source-of-truth index (the listfile). */
export interface IconIndexEntry {
  /** Stable slug = the icon name, e.g. `spell_fire_fireball02`. */
  name: string;
  /** WoW FileDataID, or null for name-only sources. */
  fileDataId: number | null;
}

/** Which icons exist. Source "A" of the two-source model (§11.1). */
export interface IconIndexSource {
  listIcons(): Promise<IconIndexEntry[]>;
}

/**
 * The image bytes for one icon. Source "B" — the pluggable adapter.
 *
 * Returns `null` when the icon simply isn't available from this source (a 404,
 * a missing pack file): the orchestrator skips it and carries on. Genuine
 * failures (network down) may throw and are caught per-icon so one bad fetch
 * never aborts a 40k-icon run.
 */
export interface IconImageSource {
  readonly name: IconSourceName;
  fetchImage(entry: IconIndexEntry): Promise<Uint8Array | null>;
}

/** Converts source image bytes to our stored format at a square target size. */
export interface ImageConverter {
  toWebp(bytes: Uint8Array, size: number): Promise<Uint8Array>;
}

/** Persists converted bytes and returns a stable, cacheable public URL. */
export interface IconStore {
  /**
   * Store `bytes` for a `size`-px variant of the icon with content address
   * `hash`; return the public URL. Content-addressed, so the same bytes always
   * map to the same immutable URL.
   */
  put(hash: string, size: number, bytes: Uint8Array): Promise<string>;
}

/** Detects the current live WoW build string, e.g. `12.1.0.68745`. */
export interface BuildDetector {
  currentBuild(): Promise<string>;
}

/** The two thumbnail sizes we store per icon (plan §11.1 "56 and 112 px"). */
export const ICON_SIZES = { small: 56, large: 112 } as const;
