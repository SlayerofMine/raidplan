import { EditorLayout } from "../editor/EditorLayout";

/**
 * `/plan/:id/edit` — the editor route. Phase 1 edits a single in-memory plan
 * (the `:id` param is ignored until plan CRUD arrives in Phase 4.4).
 */
export function EditorPage() {
  return <EditorLayout />;
}
