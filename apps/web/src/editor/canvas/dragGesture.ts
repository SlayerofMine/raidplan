/**
 * Which object is *leading* the drag currently in flight.
 *
 * Dragging one member of a multi-selection drags them all, and every one of
 * them fires its own `dragstart`/`dragend` — Konva's `Transformer` sees the
 * grabbed node move and calls `startDrag` on each of the others (see
 * `_proxyDrag`), which makes them real drags rather than nodes being pushed
 * around. So the whole selection ends up asking to be committed, once each, and
 * a group of three dragged across the board took three presses of undo to put
 * back — a member at a time, the group coming apart on the way.
 *
 * One gesture is one thing the author did, so one node speaks for it: the first
 * to start is the one the pointer actually grabbed (the others only start later,
 * from inside *its* first drag event), and it is the one that already tracks
 * where every selected node began. The rest stay silent and let it commit the
 * lot in a single action.
 *
 * Module state rather than a store field, deliberately: this is about a pointer
 * gesture in progress, has no place in the document or in history, and must be
 * readable synchronously from a Konva event handler mid-drag.
 */
let leader: string | null = null;

/**
 * Ask to lead the drag now starting. True for the first caller of a gesture —
 * which alone should track the other nodes and commit on release.
 */
export function claimDrag(id: string): boolean {
  if (leader !== null) return false;
  leader = id;
  return true;
}

/** Give up the lead on release. A no-op from anyone who never held it. */
export function releaseDrag(id: string): void {
  if (leader === id) leader = null;
}
