import { useEffect, useRef } from "react";
import { clearHistory, useEditorStore } from "../store/editorStore";
import { loadPlan, savePlan } from "../store/persistence";
import { toPlan } from "../store/planSerialization";

/** Idle delay before an autosave fires (plan §8.8: "1–2 s idle"). */
export const AUTOSAVE_DELAY_MS = 1000;

/**
 * Local persistence for the editor (plan §2.8): restore the saved plan on
 * mount, then autosave the document ~1s after the last edit.
 *
 * Autosave subscribes to the store **imperatively** rather than through React
 * state, so a drag or a keystroke never re-renders the tree just to persist
 * (plan §8.1/§8.8). Only document changes are saved — camera and selection
 * churn is ignored by comparing the (immer-stable) document slices.
 */
export function useLocalPersistence(enabled = true): void {
  const restored = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Restore once, before the first autosave can run.
  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    const saved = loadPlan();
    if (saved) {
      useEditorStore.getState().loadPlan(saved);
      // Undo must not be able to step back across a load.
      clearHistory();
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      const documentUnchanged =
        state.objects === prev.objects &&
        state.objectIds === prev.objectIds &&
        state.background === prev.background &&
        state.title === prev.title &&
        state.raid === prev.raid &&
        state.steps === prev.steps;
      if (documentUnchanged) return;

      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        savePlan(toPlan(useEditorStore.getState()));
      }, AUTOSAVE_DELAY_MS);
    });

    return () => {
      clearTimeout(timer.current);
      unsubscribe();
    };
  }, [enabled]);
}
