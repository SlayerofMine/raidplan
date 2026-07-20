import { describe, expect, it, vi } from "vitest";
import type { RoleMapping } from "../../src/config.js";
import {
  avatarUrl,
  displayName,
  fetchGuildMember,
  isSyntheticEmail,
  roleForMember,
  syntheticEmail,
  verifyDiscordIdentity,
  type Fetch,
} from "../../src/auth/discordIdentity.js";

const GUILD = "111111111111111111";
const USER = "222222222222222222";

const mapping: RoleMapping = {
  ownerRoleIds: ["role_officer"],
  editorRoleIds: ["role_raider", "role_trial"],
  defaultRole: "viewer",
};

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

const profileRoute = (body: unknown, status = 200) => ({
  "/users/@me": [status, body] as [number, unknown],
});
const memberRoute = (body: unknown, status = 200) => ({
  [`/guilds/${GUILD}/member`]: [status, body] as [number, unknown],
});

describe("syntheticEmail", () => {
  it("mints a stable, self-describing address per Discord id", () => {
    expect(syntheticEmail(USER)).toBe(`discord-${USER}@raidplans.invalid`);
    expect(syntheticEmail(USER)).toBe(syntheticEmail(USER));
  });

  it("uses the RFC 2606 .invalid TLD so it can never reach an inbox", () => {
    // The whole point: we never asked for the real address.
    expect(syntheticEmail(USER).endsWith(".invalid")).toBe(true);
  });

  it("gives different users different addresses", () => {
    expect(syntheticEmail("1")).not.toBe(syntheticEmail("2"));
  });

  it("is recognisable afterwards", () => {
    expect(isSyntheticEmail(syntheticEmail(USER))).toBe(true);
    expect(isSyntheticEmail("real.person@example.com")).toBe(false);
  });
});

describe("displayName", () => {
  it("prefers the global name", () => {
    expect(
      displayName({ id: USER, username: "u", global_name: "Nickname" }),
    ).toBe("Nickname");
  });

  it("falls back to the username when there's no global name", () => {
    expect(displayName({ id: USER, username: "u", global_name: null })).toBe(
      "u",
    );
    expect(displayName({ id: USER, username: "u", global_name: "  " })).toBe(
      "u",
    );
  });
});

describe("avatarUrl", () => {
  it("builds the CDN url for a custom avatar", () => {
    expect(avatarUrl({ id: USER, username: "u", avatar: "abc" })).toBe(
      `https://cdn.discordapp.com/avatars/${USER}/abc.png`,
    );
  });

  it("uses gif for animated avatars", () => {
    expect(avatarUrl({ id: USER, username: "u", avatar: "a_abc" })).toContain(
      ".gif",
    );
  });

  it("falls back to a default avatar when there is none", () => {
    const url = avatarUrl({ id: USER, username: "u", avatar: null });
    expect(url).toMatch(/embed\/avatars\/[0-5]\.png$/);
  });

  it("uses the legacy discriminator for a default avatar when present", () => {
    const url = avatarUrl({
      id: USER,
      username: "u",
      avatar: null,
      discriminator: "0007",
    });
    expect(url).toBe("https://cdn.discordapp.com/embed/avatars/2.png"); // 7 % 5
  });
});

describe("roleForMember", () => {
  it("promotes officers to owner", () => {
    expect(roleForMember(["role_officer"], mapping)).toBe("owner");
  });

  it("promotes raiders to editor", () => {
    expect(roleForMember(["role_raider"], mapping)).toBe("editor");
  });

  it("gives everyone else the default role", () => {
    expect(roleForMember(["role_random"], mapping)).toBe("viewer");
    expect(roleForMember([], mapping)).toBe("viewer");
  });

  it("takes the highest role when several match", () => {
    // An officer who is also a raider must not be demoted.
    expect(roleForMember(["role_raider", "role_officer"], mapping)).toBe(
      "owner",
    );
  });

  it("gives every member the default role when nothing is mapped", () => {
    const unmapped: RoleMapping = {
      ownerRoleIds: [],
      editorRoleIds: [],
      defaultRole: "editor",
    };
    expect(roleForMember(["role_officer"], unmapped)).toBe("editor");
  });
});

describe("fetchGuildMember", () => {
  it("returns the member for someone on the server", async () => {
    const member = await fetchGuildMember(
      "tok",
      GUILD,
      stubFetch(memberRoute({ roles: ["role_raider"] })),
    );
    expect(member?.roles).toEqual(["role_raider"]);
  });

  it("returns null when they aren't on the server (Discord 404s)", async () => {
    const member = await fetchGuildMember(
      "tok",
      GUILD,
      stubFetch(memberRoute({ message: "Unknown Guild" }, 404)),
    );
    expect(member).toBeNull();
  });

  it("fails closed when Discord errors — an outage is not an open door", async () => {
    for (const status of [401, 429, 500, 503]) {
      const member = await fetchGuildMember(
        "tok",
        GUILD,
        stubFetch(memberRoute({}, status)),
      );
      expect(member).toBeNull();
    }
  });

  it("fails closed when the network throws", async () => {
    const exploding = (() => {
      throw new Error("ECONNRESET");
    }) as unknown as Fetch;
    await expect(fetchGuildMember("tok", GUILD, exploding)).resolves.toBeNull();
  });

  it("fails closed on a malformed response", async () => {
    const member = await fetchGuildMember(
      "tok",
      GUILD,
      stubFetch(memberRoute({ nick: "no roles array" })),
    );
    expect(member).toBeNull();
  });

  it("asks about one server, not the user's whole server list", async () => {
    const spy = stubFetch(memberRoute({ roles: [] }));
    await fetchGuildMember("tok", GUILD, spy);
    const url = String(
      (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0],
    );
    expect(url).toBe(
      `https://discord.com/api/users/@me/guilds/${GUILD}/member`,
    );
  });
});

describe("verifyDiscordIdentity — the login gate", () => {
  const ok = (roles: string[] = ["role_raider"]) =>
    stubFetch({
      ...memberRoute({ roles }),
      ...profileRoute({ id: USER, username: "willy", avatar: "abc" }),
    });

  it("admits a member of the server with their mapped role", async () => {
    const identity = await verifyDiscordIdentity({
      accessToken: "tok",
      guildId: GUILD,
      roleMapping: mapping,
      fetchImpl: ok(["role_officer"]),
    });
    expect(identity).toMatchObject({
      discordId: USER,
      name: "willy",
      role: "owner",
      email: `discord-${USER}@raidplans.invalid`,
    });
  });

  it("refuses someone who isn't on the server", async () => {
    const identity = await verifyDiscordIdentity({
      accessToken: "tok",
      guildId: GUILD,
      roleMapping: mapping,
      fetchImpl: stubFetch({
        ...profileRoute({ id: USER, username: "stranger" }),
        ...memberRoute({ message: "Unknown Guild" }, 404),
      }),
    });
    // No account, no session — this is the gate.
    expect(identity).toBeNull();
  });

  it("refuses when the profile can't be read", async () => {
    const identity = await verifyDiscordIdentity({
      accessToken: "bad",
      guildId: GUILD,
      roleMapping: mapping,
      fetchImpl: stubFetch({
        ...profileRoute({ message: "401: Unauthorized" }, 401),
        ...memberRoute({ roles: ["role_officer"] }),
      }),
    });
    expect(identity).toBeNull();
  });

  it("never returns a real email — we don't ask for that scope", async () => {
    const identity = await verifyDiscordIdentity({
      accessToken: "tok",
      guildId: GUILD,
      roleMapping: mapping,
      // Even if Discord volunteered one, it must not be used.
      fetchImpl: stubFetch({
        ...memberRoute({ roles: [] }),
        ...profileRoute({
          id: USER,
          username: "willy",
          email: "real@example.com",
        }),
      }),
    });
    expect(identity!.email).toBe(syntheticEmail(USER));
    expect(isSyntheticEmail(identity!.email)).toBe(true);
  });
});
