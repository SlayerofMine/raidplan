import { PlanSchema, type Plan } from "@raidplan/shared";

/**
 * Local persistence (plan §2.8). The whole plan is one small JSON blob, so we
 * store it verbatim under a versioned key. Everything read back is re-validated
 * with the shared zod schema: a corrupt or outdated blob must degrade to "no
 * saved plan" rather than crash the editor.
 *
 * `storage` is injected so these are testable without touching a real browser
 * and so a future backend swap has an obvious seam.
 */
export const STORAGE_KEY = "raidplans.plan.local.v1";

/** Persist a plan. Returns false if storage is unavailable (quota, private mode). */
export function savePlan(plan: Plan, storage: Storage = localStorage): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

/** Load a validated plan, or null when absent/corrupt/invalid. Never throws. */
export function loadPlan(storage: Storage = localStorage): Plan | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = PlanSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Drop the saved plan (used by "reset"/"new plan"). */
export function clearPlan(storage: Storage = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
