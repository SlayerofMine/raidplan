import type { Viewer } from "../auth/access.js";

/**
 * May this viewer trigger an icon sync over HTTP (plan §11.1 "admin/owner-
 * gated")?
 *
 * Kept deliberately narrow and explicit: an allowlist of Discord ids
 * (`ICON_ADMIN_USER_IDS`), not a role heuristic. A sync is an expensive,
 * infrastructure-touching operation; the safe default is that an *empty*
 * allowlist admits no one over HTTP, leaving the systemd timer / CLI as the
 * only trigger. Pure so it is exhaustively testable, like the other access
 * helpers.
 */
export function isIconAdmin(
  viewer: Viewer | null,
  adminUserIds: readonly string[],
): boolean {
  if (!viewer) return false;
  return adminUserIds.includes(viewer.userId);
}
