import { TRPCError } from "@trpc/server";
import { canEdit, canView, type Viewer } from "../auth/access.js";
import type { Db } from "../db/client.js";
import { findPlanRow, toAcl } from "../plans/planRepo.js";

/**
 * "May this viewer see / change this plan?", as procedures ask it.
 *
 * Extracted from `planRouter` when a second router needed the same decision
 * (§19.1): a plan-scoped resource is readable by whoever may view its plan and
 * writable by whoever may edit it, and that must be the *same* decision the
 * plan's own procedures make, not a second implementation of it that can drift.
 *
 * A caller who may not *see* a plan gets `NOT_FOUND`, never `FORBIDDEN`:
 * telling a stranger "this exists but isn't yours" leaks that it exists.
 */

/** Load a plan row and assert the viewer may see it, or 404. */
export function requireViewable(db: Db, planId: string, viewer: Viewer | null) {
  const row = findPlanRow(db, planId);
  if (!row || !canView(toAcl(row), viewer)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such plan." });
  }
  return row;
}

/** As above, but the viewer must also be allowed to change it. */
export function requireEditable(db: Db, planId: string, viewer: Viewer) {
  const row = requireViewable(db, planId, viewer);
  if (!canEdit(toAcl(row), viewer)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can't edit this plan.",
    });
  }
  return row;
}

/** May this viewer see the plan, without throwing — for filtering a list. */
export function mayView(
  db: Db,
  planId: string,
  viewer: Viewer | null,
): boolean {
  const row = findPlanRow(db, planId);
  return row ? canView(toAcl(row), viewer) : false;
}
