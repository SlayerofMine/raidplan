import { create } from "zustand";
import { getIconById } from "@raidplan/shared";

/**
 * Resolve a token's image source (plan §11.1 "Frontend integration").
 *
 * A plan stores an icon's **stable id**, never a URL. Bundled tokens
 * (`marker-1`, `class-mage`, …) resolve to inline data URIs from the shared
 * manifest; synced WoW icons resolve to a served URL that the palette registers
 * as it searches and that {@link useResolveSyncedIcons} fetches for a plan's own
 * ids on load.
 *
 * The synced URLs live in a **reactive** store, not a plain map: a plan loads
 * before its icons are resolved (resolution is an async fetch), so tokens first
 * render with no source and must re-render once the URL arrives. A subscribable
 * store is what makes that second render happen.
 */
interface SyncedIconState {
  /** Synced icon id → served URL. */
  urls: Record<string, string>;
  register: (entries: readonly { id: string; url: string }[]) => void;
}

export const useSyncedIcons = create<SyncedIconState>((set) => ({
  urls: {},
  register: (entries) =>
    set((state) => {
      let changed = false;
      const urls = { ...state.urls };
      for (const { id, url } of entries) {
        if (urls[id] !== url) {
          urls[id] = url;
          changed = true;
        }
      }
      // Return the same reference when nothing changed so subscribers don't
      // re-render (and the resolve effect doesn't loop).
      return changed ? { urls } : state;
    }),
}));

/** Record the current served URL for one synced icon id. */
export function registerSyncedIconUrl(id: string, url: string): void {
  useSyncedIcons.getState().register([{ id, url }]);
}

/** Record many at once (a search page, or a plan's resolved ids). */
export function registerSyncedIcons(
  entries: readonly { id: string; url: string }[],
): void {
  useSyncedIcons.getState().register(entries);
}

/**
 * Reactive resolver for components: bundled manifest first, then the synced
 * store. Re-renders the caller when the synced URL for `iconId` appears.
 */
export function useIconSrc(iconId: string | undefined): string | undefined {
  const syncedUrl = useSyncedIcons((s) =>
    iconId ? s.urls[iconId] : undefined,
  );
  if (!iconId) return undefined;
  return getIconById(iconId)?.src ?? syncedUrl;
}

/** Non-reactive resolver for tests and non-component callers. */
export function resolveIconSrc(iconId: string | undefined): string | undefined {
  if (!iconId) return undefined;
  return getIconById(iconId)?.src ?? useSyncedIcons.getState().urls[iconId];
}

/** Test seam: forget everything registered. */
export function clearSyncedIconUrls(): void {
  useSyncedIcons.setState({ urls: {} });
}
