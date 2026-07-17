import { useEffect } from "react";
import { getIconById } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { resolveIcons } from "../api/iconCatalog";
import { registerSyncedIcons, useSyncedIcons } from "./iconSrc";

/**
 * Fetches URLs for any **synced** WoW icons a loaded plan references but that
 * aren't resolvable yet (plan §11.1 "Opening a plan resolves only the ids it
 * actually uses").
 *
 * Without this, reopening a saved plan shows its WoW tokens as blank: the object
 * carries the icon's stable id, but its URL only lived in the palette's memory
 * from when it was placed — a fresh page load knows nothing about it. Here we
 * ask `/api/icons/resolve` for exactly the ids on the board and register them.
 *
 * Keyed on `objectIds` (structural changes: load, add, delete — not drags) and
 * the resolved set, so it fires when there's something new to resolve and
 * quiesces the moment everything is known. Bundled ids are skipped — they need
 * no server round-trip.
 */
export function useResolveSyncedIcons(): void {
  const objectIds = useEditorStore((s) => s.objectIds);
  const resolved = useSyncedIcons((s) => s.urls);

  useEffect(() => {
    const objects = useEditorStore.getState().objects;
    const missing = new Set<string>();
    for (const id of objectIds) {
      const iconId = objects[id]?.iconId;
      if (!iconId) continue;
      if (getIconById(iconId)) continue; // bundled — no resolution needed
      if (resolved[iconId]) continue; // already resolved this session
      missing.add(iconId);
    }
    if (missing.size === 0) return;

    let cancelled = false;
    resolveIcons([...missing])
      .then((entries) => {
        if (!cancelled) registerSyncedIcons(entries);
      })
      .catch(() => {
        // Offline, or the catalog isn't synced: leave the tokens unresolved
        // rather than break the board.
      });
    return () => {
      cancelled = true;
    };
  }, [objectIds, resolved]);
}

/**
 * Null-rendering host for {@link useResolveSyncedIcons}. Mounted in the editor
 * and the viewer so the subscription's re-renders stay on this tiny component
 * rather than the shell it lives in.
 */
export function SyncedIconResolver(): null {
  useResolveSyncedIcons();
  return null;
}
