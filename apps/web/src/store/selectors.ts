import { resolveObjectState, type ObjectState } from "@raidplan/shared";
import type { EditorState } from "./editorStore";

/**
 * The state an object should be *drawn* in right now: its base with the current
 * step's overrides applied (plan §5 "state resolution").
 *
 * Resolving per object (rather than resolving the whole plan once) keeps each
 * node's store subscription independent, so moving one token doesn't re-render
 * the other 49 (plan §8.2). It's O(steps) per object — trivial at plan scale.
 *
 * Pair with `useShallow`: this returns a fresh object each call, and an
 * unmemoized selector would otherwise never settle.
 */
export function selectObjectState(
  s: EditorState,
  objectId: string,
): ObjectState | undefined {
  const object = s.objects[objectId];
  if (!object) return undefined;
  return resolveObjectState(object, s.steps, s.currentStepIndex);
}
