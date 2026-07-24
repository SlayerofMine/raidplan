import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "../db/authSchema.js";
import { verifyDiscordIdentity, type Fetch } from "./discordIdentity.js";
import { syncDomainUser } from "./syncDomainUser.js";

/**
 * better-auth wiring: Discord OAuth + sessions (plan §10).
 *
 * Two things are deliberate here:
 *
 * 1. **`getUserInfo` is the gate.** It's the only provider hook handed the
 *    access token, which is exactly what `guilds.members.read` needs. Returning
 *    `null` refuses the login outright — someone who isn't on the server never
 *    gets a user row or a session, rather than being created and then filtered
 *    later.
 * 2. **Scopes stay minimal.** `disableDefaultScope` drops better-auth's default
 *    `identify email`; we ask for `identify` + `guilds.members.read` only, and
 *    synthesize the email better-auth's model requires.
 */
export interface AuthDeps {
  db: Db;
  config: Config;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: Fetch;
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * The provider's identity gate, extracted from the better-auth `getUserInfo`
 * hook so it can be exercised directly instead of only through a full OAuth
 * callback.
 *
 * Verify the Discord access token, refuse anyone who isn't on the server (or
 * when Discord is unreachable), and project the verified identity onto our
 * domain tables while we still know their role. Returning `null` refuses the
 * login outright — no user row, no session.
 */
export async function discordUserInfo(
  { db, config, fetchImpl }: AuthDeps,
  accessToken: string,
) {
  const identity = await verifyDiscordIdentity({
    accessToken,
    guildId: config.DISCORD_GUILD_ID!,
    roleMapping: config.roleMapping,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  // Not on the server (or Discord unreachable) → no login at all.
  if (!identity) return null;

  // Project the verified identity onto our domain tables now, while we still
  // know their role. better-auth owns `user`; this owns `users`.
  syncDomainUser(db, config, identity);

  return {
    user: {
      id: identity.discordId,
      name: identity.name,
      email: identity.email,
      emailVerified: false,
      image: identity.image,
    },
    data: { id: identity.discordId },
  };
}

export function createAuth({ db, config, fetchImpl }: AuthDeps) {
  if (!config.authEnabled) {
    throw new Error("createAuth called without Discord/session config");
  }

  return betterAuth({
    baseURL: config.BASE_URL,
    secret: config.SESSION_SECRET!,
    // The SPA's origin differs from the API's in development (Vite :5173 vs
    // :4000); better-auth rejects a post-login redirect to an untrusted origin.
    trustedOrigins: [config.BASE_URL, config.webOrigin],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    // Discord is the only way in; there are no passwords to manage.
    emailAndPassword: { enabled: false },
    socialProviders: {
      discord: {
        clientId: config.DISCORD_CLIENT_ID!,
        clientSecret: config.DISCORD_CLIENT_SECRET!,
        // Drop better-auth's default `identify email` and ask for exactly what
        // we need. `guilds.members.read` answers one question — "are they on
        // our server?" — without listing every server they belong to.
        disableDefaultScope: true,
        scope: ["identify", "guilds.members.read"],
        getUserInfo: (token) =>
          discordUserInfo(
            { db, config, ...(fetchImpl ? { fetchImpl } : {}) },
            token.accessToken!,
          ),
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh at most daily
    },
    advanced: {
      // The plan's cookie policy (§10): httpOnly, SameSite=Lax, Secure in prod.
      useSecureCookies: config.BASE_URL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
  });
}
