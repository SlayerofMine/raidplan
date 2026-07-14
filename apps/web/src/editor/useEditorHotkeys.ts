import { useEffect } from "react";
import { useEditorStore } from "../store/editorStore";
import { isEditableTarget } from "./isEditableTarget";

/**
 * Global editor keyboard shortcuts (plan §1.5). Phase 1: Delete/Backspace removes
 * the selection. (Space-to-pan is owned by the canvas.) The zundo undo/redo and
 * the wider shortcut set land in Phase 2.7.
 */
export function useEditorHotkeys() {
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const selectObject = useEditorStore((s) => s.selectObject);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        selectObject(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, selectObject]);
}
