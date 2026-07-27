import { resolveObjectState, type ObjectState } from "@raidplan/shared";
import type { EditorState } from "./editorStore";

/**
 * The state an object should be *drawn* in right now: its layout on the current
 * slide (plan §5 "state resolution").
 *
 * Resolving per object (rather than resolving the whole plan once) keeps each
 * node's store subscription independent, so moving one token doesn't re-render
 * the other 49 (plan §8.2).
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
  return resolveObjectState(object, s.slides, s.currentSlideIndex);
}

/**
 * The sizes of the current selection, as a value the canvas can compare — the
 * one thing Konva's `Transformer` cannot notice for itself.
 *
 * The Transformer re-measures when a node it is attached to changes `width` or
 * `height`, and an object's node is a `Group` whose size lives on the *children*
 * `ObjectContent` draws. So a committed resize never reaches it. Worse, it
 * actively re-measures at the wrong moment: `onTransformEnd` folds the gesture's
 * scale back to 1, which fires `scaleXChange` while the children are still their
 * old size, and the re-render that finally resizes them fires nothing at all.
 * The handles snap back to the size the object started at and stay there until
 * the selection is rebuilt — which is why unselecting and reselecting fixed it.
 *
 * A placed attack needs none of this: its grab frame is a real `Rect` carrying
 * `width`/`height`, which the Transformer does watch.
 *
 * Sizes only, and resolved for the current slide so a slide change counts too.
 * Position and rotation are attributes of the `Group` itself, so those it hears.
 *
 * A string rather than an array because it is read through a store subscription:
 * a fresh array every call would never settle, and this compares by value.
 */
export function selectSelectionSizes(s: EditorState): string {
  return s.selectedIds
    .map((id) => {
      const state = selectObjectState(s, id);
      return state ? `${id}:${state.w}x${state.h}` : id;
    })
    .join(" ");
}
