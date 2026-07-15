import { useParams } from "react-router-dom";
import { EditorLayout } from "../editor/EditorLayout";
import { LOCAL_PLAN_ID } from "../editor/planScope";

/**
 * `/plan/:id/edit` — the editor route.
 *
 * The `:id` selects where the plan lives: the reserved `local` id is the
 * offline scratch plan in localStorage (no account needed), anything else is a
 * server plan loaded over tRPC. Keeping the local plan means you can try the
 * editor, and keep working, without signing in at all.
 */
export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const planId = id ?? LOCAL_PLAN_ID;
  // Remount on id change so persistence never carries state between plans.
  return <EditorLayout key={planId} planId={planId} />;
}
