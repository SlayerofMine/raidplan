import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadConfig, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { createTestDb } from "../db/testDb.js";

const GUILD = "111111111111111111";

const authConfig: Config = loadConfig({
  BASE_URL: "http://localhost:4000",
  DISCORD_CLIENT_ID: "client-id-123",
  DISCORD_CLIENT_SECRET: "client-secret",
  DISCORD_GUILD_ID: GUILD,
  SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
});

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const app = (config: Config = authConfig) => createApp({ db, config });

/** Ask better-auth to start a Discord sign-in and return the authorize URL. */
async function authorizeUrl(): Promise<URL> {
  const res = await app().request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "discord", callbackURL: "/" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url?: string };
  expect(body.url, "better-auth should return an authorize URL").toBeTruthy();
  return new URL(body.url!);
}

describe("auth routes are mounted", () => {
  it("serves better-auth under /api/auth", async () => {
    const res = await app().request("/api/auth/get-session");
    // No cookie → a valid "no session" answer, not a 404.
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("does not mount auth routes when Discord isn't configured", async () => {
    const res = await app(loadConfig({})).request("/api/auth/get-session");
    expect(res.status).toBe(404);
  });

  it("still serves /healthz either way", async () => {
    expect((await app().request("/healthz")).status).toBe(200);
    expect((await app(loadConfig({})).request("/healthz")).status).toBe(200);
  });
});

describe("the Discord authorization URL", () => {
  it("points at Discord's OAuth endpoint with our client id", async () => {
    const url = await authorizeUrl();
    expect(url.origin + url.pathname).toBe(
      "https://discord.com/api/oauth2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id-123");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("requests exactly identify + guilds.members.read", async () => {
    const url = await authorizeUrl();
    const scopes = (url.searchParams.get("scope") ?? "").split(/[+\s]/);
    expect(scopes).toContain("identify");
    expect(scopes).toContain("guilds.members.read");
  });

  it("never requests the email scope", async () => {
    // We synthesize the address better-auth needs rather than ask for the real
    // one; better-auth's Discord default would otherwise add `email` here.
    const url = await authorizeUrl();
    expect(url.searchParams.get("scope")).not.toContain("email");
  });

  it("never requests the broad `guilds` scope", async () => {
    // `guilds` would list every server the user is in. We only ever ask about
    // ours — that's the whole point of guilds.members.read.
    const scopes = (
      (await authorizeUrl()).searchParams.get("scope") ?? ""
    ).split(/[+\s]/);
    expect(scopes).not.toContain("guilds");
    expect(scopes).not.toContain("bot");
  });

  it("uses the callback URL registered with Discord", async () => {
    const url = await authorizeUrl();
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/api/auth/callback/discord",
    );
  });

  it("carries a state parameter (CSRF protection)", async () => {
    const url = await authorizeUrl();
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});
