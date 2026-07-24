import { useMemo } from "react";
import { useEditorStore } from "../store/editorStore";
import { objectDisplayName } from "./objectName";

/**
 * What a thing may be told to follow: everything else on the board, named the
 * way the rest of the editor names it (plan §18.17).
 *
 * `exclude` keeps a thing off its own list — an object pinned to itself has
 * nothing to say, and offering it invites the question.
 *
 * Tethers are left out because they have no position of their own: their line is
 * derived from the two ends, so following one would mean following an average
 * nobody drew.
 *
 * The rows are built in a `useMemo` from the store's own stable references
 * rather than inside the selector: a selector that returns fresh objects is
 * never equal to its last result, which spins the component forever.
 */
export function useFollowChoices(
  exclude?: string,
): { id: string; label: string }[] {
  const objectIds = useEditorStore((s) => s.objectIds);
  const objects = useEditorStore((s) => s.objects);

  return useMemo(
    () =>
      objectIds
        .map((id) => objects[id])
        .filter(
          (o) => o !== undefined && o.type !== "tether" && o.id !== exclude,
        )
        .map((o) => ({ id: o!.id, label: objectDisplayName(o) })),
    [objectIds, objects, exclude],
  );
}
