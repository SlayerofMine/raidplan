import { useEffect } from "react";
import { temporalStore, useEditorStore } from "../store/editorStore";
import { isEditableTarget } from "./isEditableTarget";
import { isPlaybackLocked, usePlayhead } from "./timeline/playhead";

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Global editor shortcuts (plan §2.7). Space-to-pan is owned by the canvas.
 * Everything here is ignored while a text field has focus, so typing a plan
 * title never deletes objects.
 *
 * While the Timeline's playhead is off zero, **Escape** stops it and nothing
 * else runs at all: the board is then showing a frame of an animation rather
 * than the slide, and undo in particular would step the document out from under
 * something you aren't looking at. Space stays the canvas's pan key throughout —
 * looking around a frame is harmless — so the transport doesn't take it.
 */
export function useEditorHotkeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const store = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (isPlaybackLocked()) {
        if (e.key === "Escape") {
          e.preventDefault();
          usePlayhead.getState().stop();
        }
        return;
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        // Ctrl/Cmd+Shift+Z redoes, matching platform convention.
        if (e.shiftKey) temporalStore.getState().redo();
        else temporalStore.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        temporalStore.getState().redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        store.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        store.duplicateSelected();
        return;
      }
      // Ctrl/Cmd+G groups, +Shift ungroups — the usual design-tool binding.
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) store.ungroupSelected();
        else store.groupSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        store.copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        store.paste();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        store.deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        store.clearSelection();
        return;
      }

      const nudge = NUDGE[e.key];
      if (nudge && store.selectedIds.length > 0) {
        e.preventDefault();
        store.nudgeSelected(nudge[0], nudge[1], e.shiftKey);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
