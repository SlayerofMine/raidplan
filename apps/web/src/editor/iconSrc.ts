import { getIconById } from "@raidplan/shared";

/**
 * Resolve a token's image source (plan §11.1 "Frontend integration").
 *
 * A plan stores an icon's **stable id**, never a URL. Bundled tokens
 * (`marker-1`, `class-mage`, …) resolve to inline data URIs from the shared
 * manifest; synced WoW icons resolve to a served URL that the palette and the
 * plan-load path register here as they learn it. Keeping both behind one
 * function means the canvas, and anything else that draws a token, doesn't care
 * which kind it is.
 */
const syncedIconUrls = new Map<string, string>();

/** Record the current served URL for a synced icon id. */
export function registerSyncedIconUrl(id: string, url: string): void {
  syncedIconUrls.set(id, url);
}

/** Bundled manifest first, then the synced catalog; `undefined` if unknown. */
export function resolveIconSrc(iconId: string | undefined): string | undefined {
  if (!iconId) return undefined;
  return getIconById(iconId)?.src ?? syncedIconUrls.get(iconId);
}

/** Test seam: forget everything registered. */
export function clearSyncedIconUrls(): void {
  syncedIconUrls.clear();
}
