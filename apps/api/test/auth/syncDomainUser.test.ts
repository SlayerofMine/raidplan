import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../src/config.js";
import type { Db } from "../../src/db/client.js";
import { guilds, memberships, users } from "../../src/db/schema.js";
import { createTestDb } from "../../src/db/testDb.js";
import { authAccounts, authUsers } from "../../src/db/authSchema.js";
import { createPlan } from "../../src/plans/planRepo.js";
import type { VerifiedIdentity } from "../../src/auth/discordIdentity.js";
import { syncDomainUser } from "../../src/auth/syncDomainUser.js";
import { domainUserIdFor, viewerFor } from "../../src/auth/session.js";

const GUILD_DISCORD_ID = "111111111111111111";
const USER = "222222222222222222";

const config: Config = loadConfig({
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
  SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
  DISCORD_GUILD_ID: GUILD_DISCORD_ID,
});

function identity(over: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    discordId: USER,
    name: "Willy",
    email: `discord-${USER}@raidplans.invalid`,
    image: "https://cdn.discordapp.com/avatars/x/y.png",
    role: "editor",
    ...over,
  };
}

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("syncDomainUser", () => {
  it("creates the user, the guild and the membership on first login", () => {
    syncDomainUser(db, config, identity());

    expect(db.select().from(users).all()).toMatchObject([
      { id: USER, discordId: USER, name: "Willy" },
    ]);
    expect(db.select().from(guilds).all()).toMatchObject([
      { discordGuildId: GUILD_DISCORD_ID },
    ]);
    expect(db.select().from(memberships).all()).toMatchObject([
      { userId: USER, role: "editor" },
    ]);
  });

  it("is idempotent — logging in twice doesn't duplicate anything", () => {
    syncDomainUser(db, config, identity());
    syncDomainUser(db, config, identity());

    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(guilds).all()).toHaveLength(1);
    expect(db.select().from(memberships).all()).toHaveLength(1);
  });

  it("refreshes a renamed user's name and avatar", () => {
    syncDomainUser(db, config, identity());
    syncDomainUser(db, config, identity({ name: "Renamed", image: "new.png" }));

    expect(db.select().from(users).get()).toMatchObject({
      name: "Renamed",
      avatarUrl: "new.png",
    });
  });

  it("re-applies role changes made on Discord", () => {
    syncDomainUser(db, config, identity({ role: "viewer" }));
    expect(db.select().from(memberships).get()?.role).toBe("viewer");

    // Promoted to officer on Discord → owner on their next sign-in.
    syncDomainUser(db, config, identity({ role: "owner" }));
    expect(db.select().from(memberships).get()?.role).toBe("owner");

    // …and demotions apply just as readily.
    syncDomainUser(db, config, identity({ role: "viewer" }));
    expect(db.select().from(memberships).get()?.role).toBe("viewer");
  });

  it("reuses the existing guild row for a second member", () => {
    syncDomainUser(db, config, identity());
    syncDomainUser(db, config, identity({ discordId: "333", name: "Other" }));

    expect(db.select().from(guilds).all()).toHaveLength(1);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(memberships).all()).toHaveLength(2);
  });

  it("produces a Viewer the API can authorize with", () => {
    // The payoff: the id better-auth puts in the session resolves to roles.
    syncDomainUser(db, config, identity({ role: "owner" }));
    const guildId = db.select().from(guilds).get()!.id;

    expect(viewerFor(db, USER)).toEqual({
      userId: USER,
      roles: { [guildId]: "owner" },
    });
  });

  it("does nothing when no guild is configured", () => {
    const noGuild = loadConfig({});
    syncDomainUser(db, noGuild, identity());
    expect(db.select().from(users).all()).toEqual([]);
  });

  it("leaves other members' roles alone", () => {
    syncDomainUser(db, config, identity({ role: "owner" }));
    syncDomainUser(db, config, identity({ discordId: "333", role: "viewer" }));

    const rows = db.select().from(memberships).all();
    expect(rows.find((r) => r.userId === USER)?.role).toBe("owner");
    expect(rows.find((r) => r.userId === "333")?.role).toBe("viewer");
  });
});

describe("domainUserIdFor — bridging better-auth's id to ours", () => {
  /**
   * The bug this exists for: better-auth generates its own `user.id`, so a
   * session's user id is NOT our domain id (the Discord snowflake). Treating
   * them as interchangeable made every plan.create fail on a foreign key,
   * because `plans.ownerId` references `users.id`.
   *
   * The tests missed it because `AppDeps.getUserId` is injected — the seam that
   * makes the API testable also bypassed the mapping. So test the mapping.
   */
  const AUTH_ID = "GwhgV7u07hEgAbC123";

  function linkAccount(authUserId: string, discordId: string) {
    db.insert(authUsers)
      .values({
        id: authUserId,
        name: "SlayerofMine",
        email: `discord-${discordId}@raidplans.invalid`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    db.insert(authAccounts)
      .values({
        id: `acc_${discordId}`,
        accountId: discordId,
        providerId: "discord",
        userId: authUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  }

  it("maps a better-auth session id to the Discord snowflake we key on", () => {
    linkAccount(AUTH_ID, USER);
    expect(domainUserIdFor(db, AUTH_ID)).toBe(USER);
    // The two really are different values — that's the whole point.
    expect(domainUserIdFor(db, AUTH_ID)).not.toBe(AUTH_ID);
  });

  it("returns null for a session with no linked Discord account", () => {
    // Unattributable session → anonymous, never a guess.
    expect(domainUserIdFor(db, "no-such-auth-user")).toBeNull();
  });

  it("ignores accounts from another provider", () => {
    // Battle.net is on the roadmap (§10); it must not resolve as Discord.
    db.insert(authUsers)
      .values({
        id: AUTH_ID,
        name: "X",
        email: "x@raidplans.invalid",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    db.insert(authAccounts)
      .values({
        id: "acc_bnet",
        accountId: "bnet-999",
        providerId: "battlenet",
        userId: AUTH_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    expect(domainUserIdFor(db, AUTH_ID)).toBeNull();
  });

  it("resolves to a user that plans can actually be owned by", () => {
    // The end-to-end shape of the bug: the mapped id must satisfy the
    // plans.ownerId → users.id foreign key.
    syncDomainUser(db, config, identity());
    linkAccount(AUTH_ID, USER);

    const domainId = domainUserIdFor(db, AUTH_ID)!;
    expect(() =>
      createPlan(db, {
        ownerId: domainId,
        background: { assetId: "arena", width: 1600, height: 900 },
      }),
    ).not.toThrow();

    // …and the raw session id must NOT, which is what actually happened.
    expect(() =>
      createPlan(db, {
        ownerId: AUTH_ID,
        background: { assetId: "arena", width: 1600, height: 900 },
      }),
    ).toThrow();
  });

  it("gives the mapped id the roles the session should have", () => {
    syncDomainUser(db, config, identity({ role: "owner" }));
    linkAccount(AUTH_ID, USER);

    const viewer = viewerFor(db, domainUserIdFor(db, AUTH_ID)!);
    expect(Object.values(viewer.roles)).toEqual(["owner"]);
    // Against the raw auth id it would silently have no roles at all.
    expect(viewerFor(db, AUTH_ID).roles).toEqual({});
  });
});

describe("viewerFor", () => {
  it("returns no roles for an unknown user", () => {
    expect(viewerFor(db, "ghost")).toEqual({ userId: "ghost", roles: {} });
  });

  it("collects a role per guild", () => {
    syncDomainUser(db, config, identity({ role: "editor" }));
    db.insert(guilds)
      .values({ id: "g2", name: "Other", discordGuildId: "999" })
      .run();
    db.insert(memberships)
      .values({ userId: USER, guildId: "g2", role: "owner" })
      .run();

    const viewer = viewerFor(db, USER);
    expect(Object.values(viewer.roles).sort()).toEqual(["editor", "owner"]);
  });
});
