import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { authAccounts } from "../db/authSchema.js";
import { memberships } from "../db/schema.js";
import type { Role } from "../db/schema.js";
import type { Viewer } from "./access.js";

/**
 * The bridge between better-auth's identity and ours (plan §10).
 *
 * **better-auth generates its own `user.id`.** The `id` a social provider
 * returns from `getUserInfo` becomes the *account* id, not the user id — so a
 * session's `user.id` is an opaque string like `GwhgV7u07hEg…`, while our
 * domain rows (`users`, `memberships`, `plans.ownerId`) are keyed by the
 * Discord snowflake. They are **not** interchangeable; assuming they were made
 * every `plan.create` fail on a foreign key.
 *
 * better-auth already stores the link, so we read it rather than duplicate it:
 * `account(providerId = "discord", userId = <auth id>).accountId` is the
 * snowflake.
 */
export const DISCORD_PROVIDER_ID = "discord";

/**
 * Map a better-auth session user id to our domain user id.
 *
 * Returns null when there's no linked Discord account — a session we can't
 * attribute to a domain user must be treated as anonymous, not guessed at.
 */
export function domainUserIdFor(db: Db, authUserId: string): string | null {
  const account = db
    .select({ accountId: authAccounts.accountId })
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.userId, authUserId),
        eq(authAccounts.providerId, DISCORD_PROVIDER_ID),
      ),
    )
    .get();
  return account?.accountId ?? null;
}

/**
 * Turn a **domain** user id into a {@link Viewer} — the single seam between
 * "who is signed in" and "what may they do" (`access.ts`). Swapping Discord for
 * Battle.net or email (plan §10) means changing only how a user id is obtained,
 * not this, and not the API.
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
