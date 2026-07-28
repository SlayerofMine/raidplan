import { temporalStore } from "./editorStore";

/**
 * Folding a drag into a single undo step.
 *
 * Handles that update the document every frame (so the board follows the
 * cursor) would otherwise leave one history entry per frame, and undo would
 * rewind a gesture pixel by pixel. So a drag stops recording for its duration,
 * and on release rewinds to where it began — still untracked — before applying
 * the final value once, with recording back on. React batches the two writes,
 * so nothing flickers between them.
 *
 * Callers own the values: `rewind` re-applies the state captured at
 * `beginGesture`, `commit` applies the drag's result.
 */
export function beginGesture(): void {
  temporalStore.getState().pause();
}

export function endGesture(
  gesture: { rewind: () => void; commit: () => void } | null,
): void {
  if (gesture) gesture.rewind();
  temporalStore.getState().resume();
  gesture?.commit();
}
