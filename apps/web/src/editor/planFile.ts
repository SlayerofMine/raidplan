import { PlanSchema, type Plan } from "@raidplan/shared";

/**
 * Import/export of `.json` plan files (plan §2.8). Parsing is *pure* and
 * defensive — an imported file is untrusted input, so it is validated against
 * the shared schema and failures are returned, never thrown.
 */
export type ImportResult =
  { ok: true; plan: Plan } | { ok: false; error: string };

/** Filesystem-safe name derived from the plan title. */
export function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "plan";
}

/** Parse and validate the text of a `.json` plan file. */
export function parsePlanJson(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  const parsed = PlanSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: "That file isn't a valid RaidPlans plan." };
  }
  return { ok: true, plan: parsed.data };
}

/** Serialize a plan to the exact bytes written to disk. */
export function planToJson(plan: Plan): string {
  return JSON.stringify(plan, null, 2);
}

/** Trigger a browser download of the plan as `<title>.json`. */
export function downloadPlan(plan: Plan): void {
  const blob = new Blob([planToJson(plan)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(plan.title)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
