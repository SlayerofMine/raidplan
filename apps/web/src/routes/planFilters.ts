/**
 * Pure helpers for the dashboard (plan §5.2): filtering the plan list and
 * formatting it. Kept framework-free so the fiddly bits — matching, distinct
 * raids, relative time — are unit-tested without rendering anything.
 */

export interface PlanFilter {
  query?: string;
  /** Exact raid to keep, or empty for all. Raids double as the "tags". */
  raid?: string;
}

/** Filter by a free-text query (title or raid) and an exact raid. */
export function filterPlans<T extends { title: string; raid: string }>(
  plans: readonly T[],
  filter: PlanFilter,
): T[] {
  const q = (filter.query ?? "").trim().toLowerCase();
  return plans.filter((plan) => {
    if (filter.raid && plan.raid !== filter.raid) return false;
    if (!q) return true;
    return (
      plan.title.toLowerCase().includes(q) ||
      plan.raid.toLowerCase().includes(q)
    );
  });
}

/** The distinct, non-empty raids in a plan list, sorted — the filter's options. */
export function planRaids<T extends { raid: string }>(
  plans: readonly T[],
): string[] {
  return [...new Set(plans.map((p) => p.raid).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * A compact "updated 3h ago" label. Recent times are relative; anything older
 * than a week falls back to a short date, which reads better than "42d ago".
 */
export function relativeTime(epochSeconds: number, now = Date.now()): string {
  const minutes = Math.floor((now - epochSeconds * 1000) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
