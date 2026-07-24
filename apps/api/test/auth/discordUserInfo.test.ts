import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth, discordUserInfo } from "../../src/auth/auth.js";
import { loadConfig, type Config } from "../../src/config.js";
import type { Db } from "../../src/db/client.js";
import { createTestDb } from "../../src/db/testDb.js";
import { memberships, users } from "../../src/db/schema.js";
import {
  isSyntheticEmail,
  type Fetch,
} from "../../src/auth/discordIdentity.js";

const GUILD = "111111111111111111";
const USER = "222222222222222222";

const config: Config = loadConfig({
  BASE_URL: "http://localhost:4000",
  DISCORD_CLIENT_ID: "client-id-123",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_GUILD_ID: GUILD,
  DISCORD_OWNER_ROLE_IDS: "role_officer",
  SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
});

/** A fetch stub that answers per-URL with [status, body]. */
function stubFetch(routes: Record<string, [number, unknown]>): Fetch {
  return vi.fn(async (input: Parameters<Fetch>[0]) => {
    const url = String(input);
    const hit = Object.entries(routes).find(([fragment]) =>
      url.includes(fragment),
    );
    if (!hit) return new Response("not stubbed", { status: 500 });
    const [status, body] = hit[1];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as Fetch;
}

const memberFetch = (roles: string[]): Fetch =>
  // The guild-member URL also contains "/users/@me", so the more specific
  // member fragment must be listed first for stubFetch to route it correctly.
  stubFetch({
    [`/guilds/${GUILD}/member`]: [200, { roles }],
    "/users/@me": [200, { id: USER, username: "willy", avatar: "abc" }],
  });

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("createAuth", () => {
  it("refuses to build when Discord/session config is absent", () => {
    // The guard exists because an auth instance without secrets can't sign
    // anyone in — failing loudly beats a silently broken login.
    expect(() => createAuth({ db, config: loadConfig({}) })).toThrow(
      /without Discord\/session config/,
    );
  });
});

describe("discordUserInfo — the login gate", () => {
  it("admits a server member, mapping their Discord role", async () => {
    const info = await discordUserInfo(
      { db, config, fetchImpl: memberFetch(["role_officer"]) },
      "access-token",
    );

    expect(info).not.toBeNull();
    expect(info!.user).toMatchObject({
      id: USER,
      name: "willy",
      emailVerified: false,
    });
    // better-auth is handed the Discord id as the account id, not its own uuid.
    expect(info!.data).toEqual({ id: USER });
  });

  it("synthesises the email rather than using a real one", async () => {
    const info = await discordUserInfo(
      { db, config, fetchImpl: memberFetch(["role_officer"]) },
      "access-token",
    );
    expect(isSyntheticEmail(info!.user.email)).toBe(true);
  });

  it("projects the verified identity onto the domain tables", async () => {
    await discordUserInfo(
      { db, config, fetchImpl: memberFetch(["role_officer"]) },
      "access-token",
    );

    expect(db.select().from(users).all()).toMatchObject([
      { id: USER, discordId: USER, name: "willy" },
    ]);
    // role_officer is mapped to owner in this config.
    expect(db.select().from(memberships).all()).toMatchObject([
      { userId: USER, role: "owner" },
    ]);
  });

  it("refuses someone who isn't on the server — no login, no rows", async () => {
    const info = await discordUserInfo(
      {
        db,
        config,
        fetchImpl: stubFetch({
          [`/guilds/${GUILD}/member`]: [404, { message: "Unknown Guild" }],
          "/users/@me": [200, { id: USER, username: "stranger" }],
        }),
      },
      "access-token",
    );

    expect(info).toBeNull();
    // The gate must not create a domain user for a rejected login.
    expect(db.select().from(users).all()).toHaveLength(0);
    expect(db.select().from(memberships).all()).toHaveLength(0);
  });

  it("fails closed when Discord is unreachable", async () => {
    const info = await discordUserInfo(
      {
        db,
        config,
        fetchImpl: stubFetch({
          [`/guilds/${GUILD}/member`]: [
            503,
            { message: "Service Unavailable" },
          ],
          "/users/@me": [200, { id: USER, username: "willy" }],
        }),
      },
      "access-token",
    );
    expect(info).toBeNull();
    expect(db.select().from(users).all()).toHaveLength(0);
  });
});
