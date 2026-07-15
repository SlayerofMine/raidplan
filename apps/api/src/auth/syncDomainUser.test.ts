import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { guilds, memberships, users } from "../db/schema.js";
import { createTestDb } from "../db/testDb.js";
import type { VerifiedIdentity } from "./discordIdentity.js";
import { syncDomainUser } from "./syncDomainUser.js";
import { viewerFor } from "./session.js";

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
