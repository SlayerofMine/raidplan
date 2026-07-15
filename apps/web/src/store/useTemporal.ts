import { useStore } from "zustand";
import { temporalStore } from "./editorStore";

/**
 * Undo/redo bindings (plan §2.7, zundo). Each `useStore` selector returns a
 * primitive so the snapshot stays referentially stable — selecting an object
 * literal here would re-render on every store tick.
 */
export function useTemporal() {
  const canUndo = useStore(temporalStore, (s) => s.pastStates.length > 0);
  const canRedo = useStore(temporalStore, (s) => s.futureStates.length > 0);
  return {
    canUndo,
    canRedo,
    undo: () => temporalStore.getState().undo(),
    redo: () => temporalStore.getState().redo(),
  };
}
