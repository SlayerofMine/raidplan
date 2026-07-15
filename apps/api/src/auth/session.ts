import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { memberships } from "../db/schema.js";
import type { Role } from "../db/schema.js";
import type { Viewer } from "./access.js";

/**
 * Turning an authenticated user id into a {@link Viewer} — the single seam
 * between "who is signed in" (the auth provider's problem) and "what may they
 * do" (`access.ts`). Swapping Discord for Battle.net or email (plan §10) means
 * changing only how a user id is obtained, not this, and not the API.
 */
export function viewerFor(db: Db, userId: string): Viewer {
  const rows = db
    .select({ guildId: memberships.guildId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .all();

  const roles: Record<string, Role> = {};
  for (const row of rows) roles[row.guildId] = row.role;
  return { userId, roles };
}
