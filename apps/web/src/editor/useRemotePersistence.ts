import { useEffect, useRef, useState } from "react";
import { api, isConflict } from "../api/client";
import { clearHistory, useEditorStore } from "../store/editorStore";
import { toPlan } from "../store/planSerialization";

/** Idle delay before an autosave fires (plan §8.8: "1–2 s idle"). */
export const AUTOSAVE_DELAY_MS = 1000;

export type SaveState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "saving" }
  | { status: "conflict" }
  | { status: "error"; message: string };

export type RemoteStatus = SaveState & {
  /**
   * The plan's share slug, once loaded. The editor addresses plans by id but
   * the viewer and share links use the slug, so anything linking out of the
   * editor needs this rather than the id in the URL.
   */
  slug: string | null;
};

/**
 * Server-backed persistence for one plan (plan §4.4).
 *
 * Mirrors `useLocalPersistence`, with two differences that matter:
 *
 *  - **Optimistic concurrency.** Every save carries the `version` we loaded. If
 *    someone else (or another tab) saved first the server answers CONFLICT and
 *    we stop autosaving rather than quietly overwrite their work (plan §15).
 *    Last-write-wins is only acceptable when the loser knows they lost.
 *  - **Autosave subscribes to the store imperatively**, so a drag or a keystroke
 *    never re-renders the tree just to persist (plan §8.1/§8.8).
 */
/** Pass `null` for the offline plan: the hook still runs, but does nothing. */
export function useRemotePersistence(planId: string | null): RemoteStatus {
  const [state, setState] = useState<SaveState>({ status: "loading" });
  const [slug, setSlug] = useState<string | null>(null);
  const version = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  /** Set once a save is refused; stops us hammering a doomed write. */
  const stopped = useRef(false);

  // Load the plan once, before autosave can fire.
  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    stopped.current = false;
    version.current = null;
    setSlug(null);
    setState({ status: "loading" });

    api.plan.get
      .query({ id: planId })
      .then((plan) => {
        if (cancelled) return;
        version.current = plan.version;
        setSlug(plan.slug);
        useEditorStore.getState().loadPlan(plan.doc);
        // Undo must not be able to step back across the load.
        clearHistory();
        setState({ status: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        stopped.current = true;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not load this plan.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [planId]);

  useEffect(() => {
    if (!planId) return;
    const unsubscribe = useEditorStore.subscribe((next, prev) => {
      const documentUnchanged =
        next.objects === prev.objects &&
        next.objectIds === prev.objectIds &&
        next.background === prev.background &&
        next.title === prev.title &&
        next.raid === prev.raid &&
        next.steps === prev.steps;
      // Ignore camera/selection churn, and don't fight a lost race.
      if (documentUnchanged || stopped.current || version.current === null) {
        return;
      }

      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const expectedVersion = version.current;
        if (expectedVersion === null) return;
        setState({ status: "saving" });

        api.plan.saveDoc
          .mutate({
            id: planId,
            doc: toPlan(useEditorStore.getState()),
            expectedVersion,
          })
          .then((result) => {
            version.current = result.version;
            setState({ status: "ready" });
          })
          .catch((error: unknown) => {
            if (isConflict(error)) {
              // Someone else has newer work. Stop, and let the user reload —
              // silently retrying would destroy exactly what we protected.
              stopped.current = true;
              setState({ status: "conflict" });
              return;
            }
            setState({
              status: "error",
              message:
                error instanceof Error ? error.message : "Could not save.",
            });
          });
      }, AUTOSAVE_DELAY_MS);
    });

    return () => {
      clearTimeout(timer.current);
      unsubscribe();
    };
  }, [planId]);

  return { ...state, slug };
}
