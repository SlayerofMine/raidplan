import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const AUTH = {
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
  SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
};

describe("loadConfig", () => {
  it("applies defaults for a bare environment", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      PORT: 4000,
      NODE_ENV: "development",
      authEnabled: false,
    });
  });

  it("coerces PORT from its string environment value", () => {
    expect(loadConfig({ PORT: "8080" }).PORT).toBe(8080);
  });

  it("rejects a nonsense PORT rather than silently defaulting", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("rejects a BASE_URL that isn't a URL", () => {
    expect(() => loadConfig({ BASE_URL: "nope" })).toThrow(/BASE_URL/);
  });

  it("rejects a too-short session secret", () => {
    expect(() => loadConfig({ SESSION_SECRET: "short" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("enforces better-auth's 32-char entropy floor at boot", () => {
    // better-auth only *warns* about a weak secret at runtime; a warning in a
    // log nobody reads is not a control. 31 chars must fail outright.
    expect(() => loadConfig({ SESSION_SECRET: "x".repeat(31) })).toThrow(
      /SESSION_SECRET/,
    );
    expect(() => loadConfig({ SESSION_SECRET: "x".repeat(32) })).not.toThrow();
  });

  it("accepts what `openssl rand -base64 32` produces", () => {
    // 32 random bytes → 44 base64 chars; the value the runbook tells you to use.
    expect(() =>
      loadConfig({ SESSION_SECRET: "A".repeat(43) + "=" }),
    ).not.toThrow();
  });

  it("points webOrigin at the Vite dev server by default", () => {
    // The API serves no `/`, so defaulting this to BASE_URL would land every
    // developer on a 404 immediately after a successful login.
    expect(loadConfig({}).webOrigin).toBe("http://localhost:5173");
  });

  it("points webOrigin at BASE_URL in production, where Caddy serves both", () => {
    expect(
      loadConfig({
        NODE_ENV: "production",
        BASE_URL: "https://raidplans.mamzer.dev",
        ...AUTH,
      }).webOrigin,
    ).toBe("https://raidplans.mamzer.dev");
  });

  it("lets WEB_ORIGIN override either default", () => {
    expect(loadConfig({ WEB_ORIGIN: "http://localhost:9999" }).webOrigin).toBe(
      "http://localhost:9999",
    );
  });

  it("rejects a WEB_ORIGIN that isn't a URL", () => {
    expect(() => loadConfig({ WEB_ORIGIN: "nope" })).toThrow(/WEB_ORIGIN/);
  });

  it("reports authEnabled only when Discord is fully configured", () => {
    expect(loadConfig(AUTH).authEnabled).toBe(true);
    // Partial configuration is not "enabled".
    expect(
      loadConfig({
        DISCORD_CLIENT_ID: "id",
        SESSION_SECRET: AUTH.SESSION_SECRET,
      }).authEnabled,
    ).toBe(false);
  });

  it("refuses to boot in production without auth configured", () => {
    // An API that silently treats everyone as anonymous is worse than one that
    // won't start.
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/Production/);
  });

  it("boots in production once auth is configured", () => {
    expect(() => loadConfig({ NODE_ENV: "production", ...AUTH })).not.toThrow();
  });

  it("leaves DEV_AUTH off unless a truthy flag is set", () => {
    expect(loadConfig({}).devAuth).toBe(false);
    expect(loadConfig({ DEV_AUTH: "0" }).devAuth).toBe(false);
    expect(loadConfig({ DEV_AUTH: "1" }).devAuth).toBe(true);
    expect(loadConfig({ DEV_AUTH: "true" }).devAuth).toBe(true);
  });

  it("refuses DEV_AUTH in production — it would bypass sign-in for anyone", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DEV_AUTH: "1", ...AUTH }),
    ).toThrow(/DEV_AUTH/);
  });
});
