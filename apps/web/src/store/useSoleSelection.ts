import { useShallow } from "zustand/react/shallow";
import type { ObjectState, PlanObject } from "@raidplan/shared";
import { useEditorStore } from "./editorStore";
import { selectObjectState } from "./selectors";

/**
 * The one selected object, and the state it is currently drawn in.
 *
 * Both `undefined` unless the selection is exactly one object: the panels and
 * handles that ask this are the ones with nothing sensible to show for a
 * multi-selection — there is no single origin to drag, and no one value to type
 * a width into. `state` is the base with the current step's overrides applied
 * (plan §5), because what you edit is what's on the canvas, not the raw base.
 *
 * **`useShallow` is load-bearing, not tidiness.** `selectObjectState` builds a
 * fresh object every call, and zustand v5 dropped the selector memoisation v4
 * did for free: `useStore` hands React a new `getSnapshot` on every render,
 * React re-checks the snapshot whenever that identity changes, and a result
 * that isn't `Object.is`-equal schedules another render. A selector returning a
 * fresh object therefore never settles — not a stale render, but a hard
 * "Maximum update depth exceeded" the moment one object is selected.
 *
 * One hook rather than the same six lines in each caller, because that is
 * exactly how it went wrong: two copies, and only one of them wrapped.
 */
export function useSoleSelection(): {
  object: PlanObject | undefined;
  state: ObjectState | undefined;
} {
  const object = useEditorStore((s) =>
    s.selectedIds.length === 1 ? s.objects[s.selectedIds[0]!] : undefined,
  );
  const state = useEditorStore(
    useShallow((s) =>
      s.selectedIds.length === 1
        ? selectObjectState(s, s.selectedIds[0]!)
        : undefined,
    ),
  );
  return { object, state };
}
