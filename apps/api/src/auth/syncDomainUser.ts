import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { guilds, memberships, users } from "../db/schema.js";
import type { VerifiedIdentity } from "./discordIdentity.js";

/**
 * Project a verified Discord identity onto the **domain** tables (plan §10:
 * "on first login, create user; map the user to your guild").
 *
 * better-auth owns `user`/`session`/`account`; this owns `users`, `guilds` and
 * `memberships`. They share a primary key — the Discord snowflake is both the
 * better-auth `user.id` and our `users.id` — so no mapping table is needed and
 * `viewerFor()` can resolve roles from a bare user id.
 *
 * Idempotent: it runs on *every* login, not just the first, so that renames,
 * new avatars and — importantly — **role changes on Discord** are picked up.
 * Someone promoted to officer gets their `owner` role on their next sign-in;
 * someone who leaves the raid team is demoted the same way.
 */
export function syncDomainUser(
  db: Db,
  config: Config,
  identity: VerifiedIdentity,
): void {
  const guildDiscordId = config.DISCORD_GUILD_ID;
  if (!guildDiscordId) return;

  db.transaction((tx) => {
    // 1. The user. Insert on first login; refresh name/avatar after that.
    tx.insert(users)
      .values({
        id: identity.discordId,
        discordId: identity.discordId,
        name: identity.name,
        avatarUrl: identity.image,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: identity.name, avatarUrl: identity.image },
      })
      .run();

    // 2. The guild row for the configured server, created on first sight.
    let guild = tx
      .select()
      .from(guilds)
      .where(eq(guilds.discordGuildId, guildDiscordId))
      .get();
    if (!guild) {
      const id = randomUUID();
      tx.insert(guilds)
        .values({ id, name: "Guild", discordGuildId: guildDiscordId })
        .run();
      guild = {
        id,
        name: "Guild",
        discordGuildId: guildDiscordId,
        createdAt: 0,
      };
    }

    // 3. Their membership and role, re-derived from Discord on every login.
    tx.insert(memberships)
      .values({
        userId: identity.discordId,
        guildId: guild.id,
        role: identity.role,
      })
      .onConflictDoUpdate({
        target: [memberships.userId, memberships.guildId],
        set: { role: identity.role },
      })
      .run();
  });
}
