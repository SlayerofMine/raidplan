import { createHash } from "node:crypto";

/**
 * A short, stable content address for a blob of image bytes.
 *
 * Used two ways in the sync pipeline (plan §11.1): as the incremental-diff key
 * (same bytes → same hash → skip the re-fetch/convert), and as the storage
 * filename so URLs are immutable and can be cached by browser and CDN forever.
 *
 * 16 hex chars (64 bits) is ample for content-addressing a few tens of
 * thousands of icons while keeping URLs short; collisions are astronomically
 * unlikely at this scale.
 */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}
