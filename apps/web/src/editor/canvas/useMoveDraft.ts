import { useEffect } from "react";
import { create } from "zustand";
import type { Point } from "@raidplan/shared";
import { useEditorStore } from "../../store/editorStore";
import { isEditableTarget } from "../isEditableTarget";

/**
 * The in-progress drawing of a `move` (plan §7).
 *
 * A move is a journey, and a journey is drawn: pick an object, click the corners
 * it turns, and finish where it comes to rest. That is a *mode* — clicks mean
 * something different while it is on — so it needs somewhere to live, and it is
 * emphatically not part of the document: an abandoned half-drawn route must
 * leave no trace, and undo must never step back into the middle of one.
 *
 * Hence a store of its own rather than a slice of the editor's. Nothing here is
 * persisted, undone or autosaved, and there is no way to forget to exclude it.
 * The finished route is handed to `drawMove`, which is the only thing that
 * touches the plan — one action, so one undo.
 */
export interface MoveDraft {
  /** The object being routed, or `null` when no draw is in progress. */
  objectId: string | null;
  /** The slide the route will land on, fixed when drawing began. */
  slideIndex: number;
  /**
   * The animation being redrawn, if this began from an existing route. Absent
   * means a new `move`.
   */
  animId: string | undefined;
  /** Corners committed so far, in **centre** coordinates. */
  points: Point[];
  /** Where the pointer is, so the next leg can be drawn before it's committed. */
  cursor: Point | null;

  begin: (objectId: string, slideIndex: number, animId?: string) => void;
  addPoint: (at: Point) => void;
  /** Take back the last corner; on the first one, this cancels the draw. */
  undoPoint: () => void;
  setCursor: (at: Point | null) => void;
  cancel: () => void;
}

const IDLE = {
  objectId: null,
  slideIndex: 0,
  animId: undefined,
  points: [],
  cursor: null,
} satisfies Partial<MoveDraft>;

export const useMoveDraft = create<MoveDraft>()((set) => ({
  ...IDLE,

  begin: (objectId, slideIndex, animId) =>
    set({ ...IDLE, objectId, slideIndex, animId }),

  addPoint: (at) =>
    set((s) =>
      s.objectId ? { points: [...s.points, { x: at.x, y: at.y }] } : s,
    ),

  undoPoint: () =>
    set((s) =>
      // Backspace on an empty route means "I didn't want this after all",
      // which is the same thing Escape says — so it says it.
      s.points.length <= 1 ? { ...IDLE } : { points: s.points.slice(0, -1) },
    ),

  setCursor: (at) => set((s) => (s.objectId ? { cursor: at } : s)),

  cancel: () => set({ ...IDLE }),
}));

/** Is a route being drawn right now? For code that only needs the mode bit. */
export const isDrawingMove = (): boolean =>
  useMoveDraft.getState().objectId !== null;

/**
 * Keyboard for the drawing mode: **Enter** finishes, **Escape** abandons,
 * **Backspace** takes back the last corner.
 *
 * A window listener rather than canvas keys, because the pointer is on the board
 * but focus may be anywhere — and it runs in the capture phase so Escape ends
 * the draw instead of reaching the editor's own "clear the selection", and
 * Backspace doesn't delete the object being routed.
 */
export function useMoveDraftKeys() {
  const drawMove = useEditorStore((s) => s.drawMove);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const draft = useMoveDraft.getState();
      if (!draft.objectId || isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        useMoveDraft.getState().cancel();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        useMoveDraft.getState().undoPoint();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        finishMoveDraft(drawMove);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [drawMove]);
}

/**
 * Commit the draft, if it is a journey at all, and leave the mode.
 *
 * Shared by Enter, the double-click that ends a draw on the board, and the
 * panel's Finish button, so all three produce exactly the same animation.
 */
export function finishMoveDraft(
  drawMove: ReturnType<typeof useEditorStore.getState>["drawMove"],
): void {
  const { objectId, slideIndex, animId, points } = useMoveDraft.getState();
  if (objectId && points.length > 0) {
    drawMove(slideIndex, objectId, points, animId);
  }
  useMoveDraft.getState().cancel();
}
