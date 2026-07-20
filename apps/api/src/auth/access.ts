import { ROLES, type Role } from "../db/schema.js";

/**
 * Access control (plan §9 "Access control", §10 "Auth & Sharing").
 *
 * Deliberately **pure**: these take plain facts and return a decision, with no
 * database or request objects involved. Authorization is the one place a subtle
 * mistake is a security bug rather than a glitch, so it must be exhaustively
 * testable in isolation (plan §13 "access-control helpers").
 */
export type Visibility = "private" | "unlisted" | "public";

/** Who is asking. `null` is an anonymous visitor. */
export interface Viewer {
  userId: string;
  /** Guild memberships, guildId → role. */
  roles: Record<string, Role>;
}

/** The facts about a plan that decide access. */
export interface PlanAcl {
  ownerId: string;
  guildId: string | null;
  visibility: Visibility;
  deletedAt: number | null;
}

/** Is `role` at least as powerful as `minimum`? */
export function roleAtLeast(role: Role | undefined, minimum: Role): boolean {
  if (!role) return false;
  return ROLES.indexOf(role) >= ROLES.indexOf(minimum);
}

/** The viewer's role in the plan's guild, if any. */
function roleInPlanGuild(
  plan: PlanAcl,
  viewer: Viewer | null,
): Role | undefined {
  if (!viewer || !plan.guildId) return undefined;
  return viewer.roles[plan.guildId];
}

/**
 * May the viewer *see* this plan?
 *
 *  - `public` / `unlisted` — anyone with the link, no login (plan §10).
 *    (The difference between them is discoverability, i.e. whether a plan is
 *    listed — see {@link canList} — not readability.)
 *  - `private` — the owner, or a member of the plan's guild.
 *
 * A soft-deleted plan is invisible to everyone; it must not resurrect via a
 * share link.
 */
export function canView(plan: PlanAcl, viewer: Viewer | null): boolean {
  if (plan.deletedAt !== null) return false;
  if (plan.visibility === "public" || plan.visibility === "unlisted") {
    return true;
  }
  if (!viewer) return false;
  if (plan.ownerId === viewer.userId) return true;
  return roleAtLeast(roleInPlanGuild(plan, viewer), "viewer");
}

/**
 * May the viewer *change* this plan? The owner always may; otherwise it takes
 * an `editor` role in the plan's guild. Visibility is irrelevant here: a public
 * plan is readable by all and writable by none but its guild.
 */
export function canEdit(plan: PlanAcl, viewer: Viewer | null): boolean {
  if (plan.deletedAt !== null) return false;
  if (!viewer) return false;
  if (plan.ownerId === viewer.userId) return true;
  return roleAtLeast(roleInPlanGuild(plan, viewer), "editor");
}

/**
 * May the viewer delete or re-share it? Narrower than editing: only the owner
 * or a guild `owner`.
 */
export function canAdminister(plan: PlanAcl, viewer: Viewer | null): boolean {
  if (plan.deletedAt !== null) return false;
  if (!viewer) return false;
  if (plan.ownerId === viewer.userId) return true;
  return roleAtLeast(roleInPlanGuild(plan, viewer), "owner");
}

/**
 * Should this plan appear in a *listing*? This is what separates `unlisted`
 * from `public`: an unlisted plan is readable via its link but is never listed
 * to anyone but its own guild/owner.
 */
export function canList(plan: PlanAcl, viewer: Viewer | null): boolean {
  if (plan.deletedAt !== null) return false;
  if (plan.visibility === "public") return true;
  if (!viewer) return false;
  if (plan.ownerId === viewer.userId) return true;
  return roleAtLeast(roleInPlanGuild(plan, viewer), "viewer");
}

/**
 * Is this viewer a **site admin** (plan §17)? Not a guild role but a flat
 * allowlist of user ids: authoring encounters (and later attacks) is an
 * infrastructure-level capability, gated exactly like an icon sync
 * (`ICON_ADMIN_USER_IDS`, see {@link ../icons/iconAdmin.ts}). An empty allowlist
 * admits no one, which is the safe default for a self-hosted instance.
 */
export function isAdmin(
  viewer: Viewer | null,
  adminUserIds: readonly string[],
): boolean {
  if (!viewer) return false;
  return adminUserIds.includes(viewer.userId);
}
